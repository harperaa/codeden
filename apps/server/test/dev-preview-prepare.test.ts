import { writeFileSync } from "node:fs";
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

describe("sessions that can't have a preview", () => {
  it.each([
    ["no worktree of its own", { worktreePath: null }, /project folder/],
    ["a read-only session", { autonomy: "read_only" as const }, /Read-only/],
    ["a PM", { role: "pm" as const }, /Only agent sessions/],
  ])("%s: disabled with the reason, and a start is refused", async (_name, change, reason) => {
    await env.service.setProject("app", SETTINGS);
    env.addSession("s1", "app", change);
    expect(env.service.sessionState("s1", false).unavailable).toMatch(reason);
    expect(await refusal(env.service.startSession("s1"))).toBe("unavailable");
    expect(env.procs).toHaveLength(0);
  });

  it("a project that isn't a git repository, and a session in a sandbox", async () => {
    env.addProject("plain", { isGitRepo: false });
    await env.service.setProject("plain", SETTINGS);
    env.addSession("s1", "plain");
    expect(env.service.sessionState("s1", false).unavailable).toMatch(/isn't a git repository/);
    await env.service.setProject("app", SETTINGS);
    env.addSession("s2", "app");
    env.sandboxed.add("s2");
    expect(env.service.sessionState("s2", false).unavailable).toMatch(/sandbox/);
    expect(await refusal(env.service.startSession("s2"))).toBe("unavailable");
  });
});

describe("the prepare command", () => {
  const withPrepare = { ...SETTINGS, prepareCommand: "install-deps" };

  it("runs before the first start in a worktree, and again only when the lockfile changes", async () => {
    await env.service.setProject("app", withPrepare);
    const session = env.addSession("s1", "app");
    const lockfile = join(session.worktreePath ?? "", "pnpm-lock.yaml");
    writeFileSync(lockfile, "one\n");
    await env.service.startSession("s1");
    expect(env.procs.map((p) => p.spec.command)).toEqual(["install-deps"]);
    expect(env.service.sessionState("s1", false).status).toBe("preparing");
    expect(env.procs[0]?.spec.env.PORT).toBe("43100");
    env.procs[0]?.exit(0);
    await env.procs[0]?.exited;
    await new Promise((r) => setImmediate(r));
    expect(env.procs.map((p) => p.spec.command)).toEqual(["install-deps", "run-dev"]);
    expect(env.service.sessionState("s1", false).status).toBe("starting");

    await env.service.stopSession("s1");
    await start("s1");
    expect(env.procs.map((p) => p.spec.command).slice(2)).toEqual(["run-dev"]);

    await env.service.stopSession("s1");
    writeFileSync(lockfile, "two\n");
    await env.service.startSession("s1");
    expect(env.procs.at(-1)?.spec.command).toBe("install-deps");
  });

  it("a failed prepare fails the preview, starts no dev command and runs again next time", async () => {
    await env.service.setProject("app", withPrepare);
    env.addSession("s1", "app");
    await env.service.startSession("s1");
    env.procs[0]?.print("ERR_PNPM_OUTDATED_LOCKFILE\n");
    env.procs[0]?.exit(1);
    await env.procs[0]?.exited;
    await new Promise((r) => setImmediate(r));
    const state = env.service.sessionState("s1", false);
    expect(state).toMatchObject({
      status: "failed",
      message: "The prepare command exited with code 1.",
    });
    expect(state.logTail).toContain("ERR_PNPM_OUTDATED_LOCKFILE");
    expect(env.procs).toHaveLength(1);
    await env.service.startSession("s1");
    expect(env.procs.at(-1)?.spec.command).toBe("install-deps");
  });

  it("stopping while it prepares ends the prepare command and starts nothing", async () => {
    await env.service.setProject("app", withPrepare);
    env.addSession("s1", "app");
    await env.service.startSession("s1");
    await env.service.stopSession("s1");
    await new Promise((r) => setImmediate(r));
    expect(env.procs).toHaveLength(1);
    expect(env.procs[0]?.stopped).toBe(true);
    expect(env.service.sessionState("s1", false).status).toBe("off");
  });
});

describe("what is run is what is confirmed now", () => {
  it("a start already under way when the command changed never runs the old command", async () => {
    await env.service.setProject("app", SETTINGS);
    env.addSession("s1", "app");
    const starting = env.service.startSession("s1").catch(() => null);
    const changing = env.service.setProject("app", { ...SETTINGS, command: "new-dev" });
    await Promise.all([starting, changing]);
    expect(env.procs.map((p) => p.spec.command)).not.toContain("run-dev");
    // And a start under way when the preview was removed runs nothing at all.
    await env.service.stopAll();
    const before = env.procs.length;
    const again = env.service.startSession("s1").catch(() => null);
    const removing = env.service.removeProject("app");
    await Promise.all([again, removing]);
    await env.service.tick();
    expect(env.running()).toHaveLength(0);
    expect(env.procs.slice(before).every((p) => p.stopped)).toBe(true);
  });

  it("keeps the log readable: no colour codes, and only the last lines", async () => {
    await env.service.setProject("app", SETTINGS);
    env.addSession("s1", "app");
    await env.service.startSession("s1");
    env.procs[0]?.print("\u001b[32m  ready\u001b[0m in 80 ms\npart");
    env.procs[0]?.print("ial line\n");
    for (let i = 0; i < 2100; i++) env.procs[0]?.print(`line ${i}\n`);
    const { lines } = env.service.log("session:s1");
    expect(lines).toHaveLength(2000);
    expect(lines.at(-1)).toBe("line 2099");
    await env.service.stopSession("s1");
    await env.service.startSession("s1");
    env.procs[1]?.print("\u001b[32m  ready\u001b[0m in 80 ms\npart");
    env.procs[1]?.print("ial line\n");
    expect(env.service.log("session:s1").lines).toEqual([
      "$ run-dev",
      "  ready in 80 ms",
      "partial line",
    ]);
    expect(env.procs[1]?.spec.env).toMatchObject({ NO_COLOR: "1", BROWSER: "none" });
  });
});
