import { DevPreviewLog, DevPreviewProject, DevPreviewState } from "@codeden/contracts";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { devPreviewRoutes } from "../src/routes/dev-preview";
import { errorResponse } from "../src/routes/validate";
import type { AppServices } from "../src/services/container";
import { createPreviewEnv, type PreviewEnv, SETTINGS } from "./support/dev-preview-env";

let env: PreviewEnv;
let app: Hono;
beforeEach(() => {
  env = createPreviewEnv();
  env.addProject("app");
  env.addSession("s1", "app");
  app = new Hono()
    .onError((e, c) => errorResponse(e, c))
    .route("/", devPreviewRoutes({ devPreview: env.service } as unknown as AppServices));
});
afterEach(() => env.close());

const HERE = "127.0.0.1";
const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
const call = (method: string, path: string, body: unknown, peer: string) =>
  app.request(
    path,
    {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    from(peer),
  );
const confirmed = { ...SETTINGS, confirm: true };

describe("another device", () => {
  // A phone on the LAN, the same over a VPN, and an IPv4-mapped LAN address.
  const PEERS = ["192.168.1.20", "100.101.102.103", "::ffff:10.0.0.7"];
  const REFUSED: [string, string, unknown][] = [
    ["PUT", "/projects/app", confirmed],
    ["DELETE", "/projects/app", undefined],
    ["PUT", "/limits", { perProject: 9, total: 9, portFrom: 20000, portTo: 20100 }],
    ["POST", "/sessions/s1/start", undefined],
    ["PUT", "/projects/app/pm", { enabled: true }],
    ["POST", "/projects/app/base/update", undefined],
  ];

  it.each(PEERS.flatMap((peer) => REFUSED.map((r) => [peer, ...r] as const)))(
    "%s: %s %s is refused, and nothing is stored or started",
    async (peer, method, path, body) => {
      // With a command already confirmed here, so a start would otherwise work.
      await env.service.setProject("app", SETTINGS);
      const before = JSON.stringify([env.store.config("app"), env.store.limits()]);
      const res = await call(method, path, body, peer);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "this_computer_only" } });
      expect(JSON.stringify([env.store.config("app"), env.store.limits()])).toBe(before);
      expect(env.procs).toHaveLength(0);
    },
  );

  it("can't set a first command either", async () => {
    const res = await call("PUT", "/projects/app", confirmed, "192.168.1.20");
    expect(res.status).toBe(403);
    expect(env.store.config("app")).toBeNull();
  });

  it("sees the state, the link and the log, marked as remote, and can stop a preview", async () => {
    await env.service.setProject("app", SETTINGS);
    await env.service.startSession("s1");
    env.procs[0]?.print("hello\n");
    env.listening.add(43100);
    await env.service.tick();
    const state = DevPreviewState.parse(
      await (await call("GET", "/sessions/s1", undefined, "192.168.1.20")).json(),
    );
    expect(state).toMatchObject({ status: "running", url: "http://localhost:43100", remote: true });
    const project = DevPreviewProject.parse(
      await (await call("GET", "/projects/app", undefined, "192.168.1.20")).json(),
    );
    expect(project).toMatchObject({
      remote: true,
      suggestion: null,
      config: { command: "run-dev" },
    });
    const log = DevPreviewLog.parse(
      await (await call("GET", "/log?key=session:s1", undefined, "192.168.1.20")).json(),
    );
    expect(log.lines).toContain("hello");
    expect((await call("GET", "/limits", undefined, "192.168.1.20")).status).toBe(200);
    expect((await call("GET", "/projects/app/base", undefined, "192.168.1.20")).status).toBe(200);

    const stopped = await call("POST", "/sessions/s1/stop", undefined, "192.168.1.20");
    expect(await stopped.json()).toMatchObject({ status: "off", remote: true });
    expect(env.running()).toHaveLength(0);
    const off = await call("PUT", "/projects/app/pm", { enabled: false }, "192.168.1.20");
    expect(off.status).toBe(200);
    expect((await call("POST", "/stop-all", undefined, "192.168.1.20")).status).toBe(200);
  });
});

describe("this computer", () => {
  it("stores a command only with the confirmation", async () => {
    const unconfirmed = await call("PUT", "/projects/app", SETTINGS, HERE);
    expect(unconfirmed.status).toBe(400);
    const no = await call("PUT", "/projects/app", { ...SETTINGS, confirm: false }, HERE);
    expect(no.status).toBe(400);
    expect(env.store.config("app")).toBeNull();
    expect((await call("POST", "/sessions/s1/start", undefined, HERE)).status).toBe(409);

    const yes = await call("PUT", "/projects/app", confirmed, HERE);
    expect(yes.status).toBe(200);
    const project = DevPreviewProject.parse(await yes.json());
    expect(project.config).toMatchObject({ command: "run-dev", portVars: ["PORT"] });
    expect(project.config).not.toHaveProperty("confirm");
    expect(project.remote).toBe(false);
  });

  it("starts and stops a session's preview", async () => {
    await call("PUT", "/projects/app", confirmed, HERE);
    const started = await call("POST", "/sessions/s1/start", undefined, HERE);
    expect(DevPreviewState.parse(await started.json())).toMatchObject({
      status: "starting",
      ports: [43100],
      remote: false,
    });
    expect(env.procs.map((p) => p.spec.command)).toEqual(["run-dev"]);
    // The request can't bring a command of its own.
    await call("POST", "/sessions/s1/stop", undefined, HERE);
    await call("POST", "/sessions/s1/start", { command: "evil", cwd: "/" }, HERE);
    expect(env.procs.map((p) => p.spec.command)).toEqual(["run-dev", "run-dev"]);
    expect(env.procs[1]?.spec.cwd).toBe(env.sessions.get("s1")?.worktreePath);
  });

  it("refuses settings that could change how the command itself is run", async () => {
    for (const bad of [
      { portVars: ["PATH"] },
      { portVars: ["NODE_OPTIONS"] },
      { portVars: ["BASH_ENV"] },
      { portVars: ["ZDOTDIR"] },
      { portVars: ["A B"] },
      { portVars: [] },
      { portVars: ["A", "B", "C", "D", "E"] },
      { command: "   " },
      { urlPattern: "(" },
    ]) {
      const res = await call("PUT", "/projects/app", { ...confirmed, ...bad }, HERE);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(env.store.config("app")).toBeNull();
  });

  it("saves the limits, and refuses a range too small to work with", async () => {
    const ok = await call(
      "PUT",
      "/limits",
      { perProject: 2, total: 4, portFrom: 20000, portTo: 20050 },
      HERE,
    );
    expect(await ok.json()).toMatchObject({ limits: { perProject: 2, total: 4 }, remote: false });
    expect((await call("PUT", "/limits", { portFrom: 20000, portTo: 20003 }, HERE)).status).toBe(
      400,
    );
    expect(env.store.limits().portTo).toBe(20050);
  });

  it("answers 404 for a project or session that doesn't exist", async () => {
    expect((await call("GET", "/projects/nope", undefined, HERE)).status).toBe(404);
    expect((await call("GET", "/sessions/nope", undefined, HERE)).status).toBe(404);
    expect((await call("PUT", "/projects/nope", confirmed, HERE)).status).toBe(404);
  });
});
