import { DevPreviewServerList, DevPreviewServersStopped } from "@codeden/contracts";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { devPreviewRoutes } from "../src/routes/dev-preview";
import { errorResponse } from "../src/routes/validate";
import type { AppServices } from "../src/services/container";
import { createPreviewEnv, type PreviewEnv, SETTINGS } from "./support/dev-preview-env";
import { createRepos, isolatedGit, type Repos } from "./support/dev-preview-git";

/**
 * The Dev Servers page's list and stops, over scripted processes: every preview of every
 * project in one list, and stopping as the owning page's switch does. The PM thread's preview
 * runs from a real git checkout, as in the other base-branch suites.
 */
let repos: Repos;
let env: PreviewEnv;
const servers = () => env.service.servers;
const rows = () =>
  servers()
    .list(false)
    .servers.map((s) => `${s.projectName}/${s.sessionTitle ?? "PM"}: ${s.state.status}`);
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(async () => {
  repos = createRepos();
  env = createPreviewEnv({ exec: isolatedGit });
  env.projects.set("app", {
    ...env.addProject("app", { defaultBranch: "trunk" }),
    path: repos.repo,
  });
  env.addProject("shop");
  env.addSession("s1", "app", { title: "Checkout" });
  env.addSession("s2", "shop", { title: null, purpose: "Fix the cart" });
  env.addSession("s3", "shop", { title: "Never started" });
  // The PM thread's preview of "app" (port 43100), then a session in each project.
  await env.service.setProject("app", { ...SETTINGS, pmEnabled: true });
  await env.service.idle();
  await env.service.setProject("shop", SETTINGS);
  await env.service.startSession("s1");
  await env.service.startSession("s2");
});
afterEach(async () => {
  await env.close();
  repos.close();
});

describe("the list", () => {
  it("has every preview of every project that isn't off, running ones first", async () => {
    env.listening.add(43100).add(43102);
    await env.service.tick();
    const list = DevPreviewServerList.parse(servers().list(false));
    expect(rows()).toEqual([
      "app/PM: running",
      "shop/Fix the cart: running",
      "app/Checkout: starting",
    ]);
    const [pm, session] = list.servers;
    expect(pm?.state).toMatchObject({
      key: "base:app",
      url: "http://localhost:43100",
      ports: [43100],
      enabled: true,
      base: { branch: "trunk" },
    });
    expect(pm?.state.base?.commit).toMatch(/^[0-9a-f]{10}$/);
    expect(pm?.state.startedAt).not.toBeNull();
    expect(session?.state).toMatchObject({ key: "session:s2", sessionId: "s2", ports: [43102] });
    expect(list.remote).toBe(false);
  });

  it("keeps a failed preview with its reason, without the project's output", async () => {
    const first = env.procs[1];
    first?.print("SECRET=abc\n");
    first?.exit(1);
    await settle();
    // Restarted once; the second exit is final.
    env.procs.at(-1)?.exit(1);
    await settle();
    const failed = servers()
      .list(false)
      .servers.find((s) => s.state.key === "session:s1");
    expect(failed?.state).toMatchObject({ status: "failed", logTail: [] });
    expect(failed?.state.message).toMatch(/exited with code 1/);
    expect(JSON.stringify(servers().list(false))).not.toContain("SECRET");
    // The strip on its own page still has the last lines.
    expect(env.service.sessionState("s1", false).logTail.join("\n")).toContain("SECRET");
  });
});

describe("stopping", () => {
  it("switches a session's preview off as its own switch does, and it can be switched on again", async () => {
    expect(await servers().stop(["session:s1"])).toEqual({ stopped: ["session:s1"], failed: [] });
    expect(env.procs[1]?.stopped).toBe(true);
    expect(env.service.sessionState("s1", false)).toMatchObject({ status: "off", enabled: false });
    expect(rows()).toEqual(["app/PM: starting", "shop/Fix the cart: starting"]);
    await env.service.startSession("s1");
    expect(env.service.sessionState("s1", false)).toMatchObject({ status: "starting" });
    expect(env.running()).toHaveLength(3);
  });

  it("switches the PM thread's preview off for good, until a person switches it on there", async () => {
    await servers().stop(["base:app"]);
    expect(env.procs[0]?.stopped).toBe(true);
    expect(env.store.config("app")?.pmEnabled).toBe(false);
    expect(env.service.baseState("app", false)).toMatchObject({ status: "off", enabled: false });
    expect(rows()).not.toContain("app/PM: starting");
    // No look at the base branch brings it back.
    repos.pushToOrigin("index.html", "two\n");
    env.clock.now += 91_000;
    await env.service.tick();
    await env.service.idle();
    expect(env.procs).toHaveLength(3);
    await env.service.setPm("app", true);
    expect(env.service.baseState("app", false)).toMatchObject({
      status: "starting",
      enabled: true,
    });
  });

  it("stops the others when one fails, and names the one that failed", async () => {
    const stuck = env.procs[1];
    if (stuck) stuck.stop = async () => Promise.reject(new Error("It didn't end."));
    const answer = DevPreviewServersStopped.parse(
      await servers().stop(["base:app", "session:s1", "session:s2", "session:s2", "nope"]),
    );
    expect(answer.stopped).toEqual(["base:app", "session:s2"]);
    expect(answer.failed).toEqual([
      { key: "session:s1", message: "It didn't end." },
      { key: "nope", message: "Not a dev server." },
    ]);
    expect(env.procs[0]?.stopped).toBe(true);
    expect(env.procs[2]?.stopped).toBe(true);
  });

  it("a preview that is off already, or whose session is gone, counts as stopped", async () => {
    env.sessions.delete("s2");
    const answer = await servers().stop(["session:s2", "session:s3"]);
    expect(answer).toEqual({ stopped: ["session:s2", "session:s3"], failed: [] });
    expect(env.procs[2]?.stopped).toBe(true);
    expect(env.procs).toHaveLength(3);
  });

  it("Stop all stops the rest when one fails, and holds the PM thread's preview with its switch on", async () => {
    const stuck = env.procs[2];
    if (stuck) stuck.stop = async () => Promise.reject(new Error("It didn't end."));
    expect(await env.service.stopAll()).toEqual({
      stopped: 2,
      failed: [{ key: "session:s2", message: "It didn't end." }],
    });
    expect(env.procs[0]?.stopped).toBe(true);
    expect(env.procs[1]?.stopped).toBe(true);
    // Held, not switched off: it is still listed, and says how to get it back.
    expect(rows()).toEqual(["app/PM: stopped"]);
    expect(env.service.baseState("app", false)).toMatchObject({ status: "stopped", enabled: true });
    expect(servers().list(false).servers[0]?.state.message).toMatch(/Stop all/);
  });
});

describe("over the routes", () => {
  const app = () =>
    new Hono()
      .onError((e, c) => errorResponse(e, c))
      .route("/", devPreviewRoutes({ devPreview: env.service } as unknown as AppServices));
  const call = (method: string, path: string, body: unknown, remoteAddress: string) =>
    app().request(
      path,
      {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { incoming: { socket: { remoteAddress } } },
    );
  const PHONE = "192.168.1.20";

  it("another device sees the list, marked as remote, and can stop previews", async () => {
    const list = DevPreviewServerList.parse(
      await (await call("GET", "/servers", undefined, PHONE)).json(),
    );
    expect(list.remote).toBe(true);
    expect(list.servers.map((s) => s.state.remote)).toEqual([true, true, true]);
    const res = await call("POST", "/servers/stop", { keys: ["session:s1", "base:app"] }, PHONE);
    expect(DevPreviewServersStopped.parse(await res.json())).toEqual({
      stopped: ["session:s1", "base:app"],
      failed: [],
    });
    expect(env.running()).toHaveLength(1);
    // It still can't start one: these stay refused.
    expect((await call("POST", "/sessions/s1/start", undefined, PHONE)).status).toBe(403);
    expect((await call("PUT", "/projects/app/pm", { enabled: true }, PHONE)).status).toBe(403);
  });

  it("this computer gets the same list, and a stop request must name previews", async () => {
    const list = DevPreviewServerList.parse(
      await (await call("GET", "/servers", undefined, "127.0.0.1")).json(),
    );
    expect(list).toMatchObject({ remote: false });
    expect(list.servers).toHaveLength(3);
    expect((await call("POST", "/servers/stop", { keys: [] }, "127.0.0.1")).status).toBe(400);
    expect((await call("POST", "/servers/stop", {}, "127.0.0.1")).status).toBe(400);
    // A request can't bring anything but keys: nothing starts from here.
    const before = env.procs.length;
    await call("POST", "/servers/stop", { keys: ["session:s3"], command: "evil" }, "127.0.0.1");
    expect(env.procs).toHaveLength(before);
  });
});
