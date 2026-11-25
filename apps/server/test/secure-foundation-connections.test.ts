import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { secureFoundationRoutes } from "../src/routes/secure-foundation";
import { errorResponse } from "../src/routes/validate";
import type { AppServices } from "../src/services/container";
import { ServiceError } from "../src/services/errors";
import { ConnectionsService } from "../src/services/secure-foundation/connections/connections-service";
import { minimalEnv } from "../src/services/secure-foundation/connections/process";
import { toolPath } from "../src/services/secure-foundation/connections/tool-path";
import { type FakeClis, isAlive, makeFakeClis } from "./support/fake-clis";
import { waitUntil } from "./support/harness";
import { removeTree } from "./support/remove-tree";

/**
 * The Connections step against fake CLIs on a PATH of their own: nothing here signs in to a
 * real service. The fakes take only the product's fixed arguments.
 */
const posix = process.platform !== "win32";
let fakes: FakeClis;
let connections: ConnectionsService;

const service = (over: { loginTimeoutMs?: number; fakes?: FakeClis; path?: string } = {}) =>
  new ConnectionsService({
    env: () => ({
      ...(over.fakes ?? fakes).env,
      ...(over.path === undefined ? {} : { PATH: over.path }),
    }),
    loginTimeoutMs: over.loginTimeoutMs,
    // No real shell is asked and no real tool can be reached in tests.
    shellPath: async () => "",
    usualFolders: [],
  });

beforeEach(() => {
  fakes = makeFakeClis();
  connections = service();
});
afterEach(async () => {
  connections.dispose();
  await removeTree(fakes.dir);
});

const settled = (id: string, s = connections) =>
  waitUntil(() => {
    const login = s.login(id);
    return login.status === "starting" || login.status === "waiting" ? undefined : login;
  });
const waiting = (id: string, s = connections) =>
  waitUntil(() => (s.login(id).status === "waiting" ? s.login(id) : undefined));

describe.runIf(posix)("sign-in state, asked of each CLI", () => {
  it("reads signed out, then signed in with the Convex teams", async () => {
    expect(await connections.states(["convex", "doppler"])).toMatchObject([
      { service: "convex", cli: "ready", signedIn: false, teams: [] },
      { service: "doppler", cli: "ready", signedIn: false, teams: [] },
    ]);
    fakes.setMode("signed_in");
    const [convex, doppler] = await connections.states(["convex", "doppler"]);
    expect(convex).toMatchObject({ signedIn: true, message: "Signed in to Convex." });
    // A line that isn't `- Name (slug)` with a valid slug is not a team.
    expect(convex?.teams).toEqual([
      { name: "Acme Labs", slug: "acme-labs" },
      { name: "Side Project", slug: "side-project" },
    ]);
    expect(doppler).toMatchObject({ signedIn: true, teams: [] });
  });

  it("says a CLI is missing, with the install command for the person to run", async () => {
    const onlyNpx = makeFakeClis(["npx"]);
    // Only the fakes' folder on PATH: a machine that has the real tool in a system folder must
    // not make it found here, and the real one must never be asked.
    const s = service({ fakes: onlyNpx, path: onlyNpx.dir });
    const [doppler] = await s.states(["doppler"]);
    expect(doppler).toMatchObject({ cli: "missing", signedIn: null });
    expect(doppler?.install).toBeTruthy();
    // Starting its login is refused: nothing is installed for the person, nothing hangs.
    await expect(s.startLogin("doppler")).rejects.toBeInstanceOf(ServiceError);
    s.dispose();
    await removeTree(onlyNpx.dir);
  });

  it("finds npx on the PATH of the person's shell when the app's own PATH is the bare one", async () => {
    // The app as started from the Dock: nothing of the fakes' folder on its PATH.
    const bare = { ...fakes.env, PATH: "/usr/bin:/bin" };
    const asked: string[] = [];
    let shell = "";
    const s = new ConnectionsService({
      env: () => bare,
      usualFolders: [],
      shellPath: async (env) => {
        asked.push(env.PATH ?? "");
        return shell;
      },
    });
    // Not found: the row says Node.js isn't on the app's path, not "signed out".
    const [missing] = await s.states(["convex"]);
    expect(missing).toMatchObject({ cli: "missing", signedIn: null });
    expect(missing?.message).toContain("Node.js (npx) isn't on the app's path");
    await expect(s.startLogin("convex")).rejects.toBeInstanceOf(ServiceError);
    // Installed a moment ago: the shell's PATH is asked again at the next check.
    shell = `/somewhere/else:${fakes.dir}:${dirname(process.execPath)}`;
    const [found] = await s.states(["convex"]);
    expect(found).toMatchObject({ cli: "ready", signedIn: false });
    expect(asked.length).toBeGreaterThanOrEqual(3);
    // The app's own PATH stays in front, and each folder is there once.
    const path = await toolPath(bare, fakes.dir, async () => `/bin:${fakes.dir}:${fakes.dir}`, []);
    expect(path.split(":").slice(0, 3)).toEqual(["/usr/bin", "/bin", fakes.dir]);
    expect(path.split(":").filter((d) => d === fakes.dir)).toHaveLength(1);
    // A shell that fails or says nothing changes nothing.
    const failing = await toolPath(
      { PATH: "/usr/bin", HOME: fakes.dir },
      fakes.dir,
      async () => {
        throw new Error("no shell");
      },
      [],
    );
    expect(failing.split(":")[0]).toBe("/usr/bin");
    s.dispose();
  });

  it("runs the CLI with a minimal environment, in a scratch folder that isn't a project", async () => {
    await connections.states(["convex"]);
    const seen = fakes.seen("npx");
    expect(seen?.args).toBe("--yes convex@1.43.0 login status");
    expect(seen?.env).toContain("PATH");
    expect(seen?.env).toContain("HOME");
    expect(seen?.env).not.toContain("SECRET_FROM_THE_SERVER");
    expect(seen?.env).not.toContain("CODEDEN_HOME");
    expect(seen?.cwd.startsWith(realpathSync(tmpdir()))).toBe(true);
    expect(existsSync(`${seen?.cwd}/.git`)).toBe(false);
    expect(Object.keys(minimalEnv({ A_TOKEN: "x", PATH: "/bin" }))).toEqual([
      "PATH",
      "NO_COLOR",
      "FORCE_COLOR",
    ]);
  });
});

describe.runIf(posix)("a login started from the form", () => {
  it("shows the link and the code, and is done when the person finishes in the browser", async () => {
    fakes.setMode("login_ok");
    const started = await connections.startLogin("convex");
    expect(started).toMatchObject({ service: "convex", status: "starting", url: null });
    const shown = await waiting(started.id);
    expect(shown.url).toBe("https://auth.convex.dev/activate?user_code=WXYZ-1234");
    expect(shown.code).toBe("WXYZ-1234");
    // A second click joins the login that is running.
    expect((await connections.startLogin("convex")).id).toBe(started.id);
    fakes.approve();
    const done = await settled(started.id);
    expect(done).toMatchObject({ status: "done", url: null, code: null });
    expect(fakes.seen("npx")?.args).toContain("login --login-flow poll --no-open");
    expect((await connections.states(["convex"]))[0]?.signedIn).toBe(true);
  });

  it("reads Doppler's link and code through its colour codes", async () => {
    fakes.setMode("login_ok");
    const shown = await waiting((await connections.startLogin("doppler")).id);
    expect(shown.url).toBe("https://dashboard.doppler.com/workplace/auth/cli");
    expect(shown.code).toBe("fake_code_1234");
    expect(fakes.seen("doppler")?.args).toBe("login --yes --no-copy");
  });

  it("times out, and leaves no process behind", async () => {
    fakes.setMode("login_hang");
    const s = service({ loginTimeoutMs: 400 });
    const login = await s.startLogin("convex");
    const ended = await settled(login.id, s);
    expect(ended).toMatchObject({ status: "timed_out", url: null, code: null });
    const pid = fakes.pid("npx");
    if (pid) await waitUntil(() => (isAlive(pid) ? undefined : true));
    s.dispose();
  });

  it("can be cancelled, and leaves no process behind", async () => {
    fakes.setMode("login_hang");
    const login = await connections.startLogin("doppler");
    await waiting(login.id);
    const pid = fakes.pid("doppler") as number;
    expect(isAlive(pid)).toBe(true);
    expect(connections.cancel(login.id)).toMatchObject({ status: "cancelled", url: null });
    await waitUntil(() => (isAlive(pid) ? undefined : true));
    // Cancelling again changes nothing; a new login can start.
    expect(connections.cancel(login.id).status).toBe("cancelled");
    expect((await connections.startLogin("doppler")).id).not.toBe(login.id);
  });

  it("reports a login that fails, with what to do by hand", async () => {
    fakes.setMode("login_fail");
    const ended = await settled((await connections.startLogin("convex")).id);
    expect(ended.status).toBe("failed");
    expect(ended.message).toContain("npx convex login");
  });

  it("stops every login when the server closes", async () => {
    fakes.setMode("login_hang");
    await waiting((await connections.startLogin("convex")).id);
    const pid = fakes.pid("npx") as number;
    connections.dispose();
    await waitUntil(() => (isAlive(pid) ? undefined : true));
  });

  it("never accepts a link on another host as the sign-in page", () => {
    const read = (text: string) =>
      (
        connections as unknown as { commands: Record<string, { readLogin(o: string): unknown }> }
      ).commands.convex?.readLogin(text);
    expect(read("Visit https://convex.dev.evil.test/x to finish")).toMatchObject({ url: null });
    expect(read("Visit http://auth.convex.dev/x to finish")).toMatchObject({ url: null });
    expect(read("Visit https://auth.convex.dev/x. Bye")).toMatchObject({
      url: "https://auth.convex.dev/x",
    });
  });
});

describe.runIf(posix)("GitHub and Vercel, for the deploy option", () => {
  it("reads signed out for both", async () => {
    expect(await connections.states(["github", "vercel"])).toMatchObject([
      { service: "github", cli: "ready", signedIn: false, owners: [], missingScopes: [] },
      { service: "vercel", cli: "ready", signedIn: false, scopes: [] },
    ]);
    // Signed out, nobody's organisations or teams are asked for.
    expect(fakes.calls().some((c) => c.includes("user/orgs") || c.includes("teams list"))).toBe(
      false,
    );
  });

  it("lists who can own the repository, the account first, and the Vercel scopes", async () => {
    fakes.setMode("signed_in");
    const [github, vercel] = await connections.states(["github", "vercel"]);
    expect(github).toMatchObject({
      signedIn: true,
      account: "demo-person",
      owners: ["demo-person", "acme-org", "side-org"],
      missingScopes: [],
    });
    expect(vercel).toMatchObject({
      signedIn: true,
      account: "demo-person",
      scopes: [
        { slug: "acme-team", name: "Acme Team" },
        { slug: "side-team", name: "Side Team" },
      ],
    });
  });

  it("handles an account without organisations and one without teams", async () => {
    fakes.setMode("signed_in");
    fakes.write("gh.orgs", "");
    fakes.write("vercel.teams", JSON.stringify({ teams: [] }));
    const [github, vercel] = await connections.states(["github", "vercel"]);
    expect(github?.owners).toEqual(["demo-person"]);
    expect(vercel).toMatchObject({ signedIn: true, scopes: [] });
  });

  it("names a missing permission and adds it with a refresh, not a new login", async () => {
    fakes.setMode("login_ok");
    fakes.write("gh.signed-in", "");
    fakes.write("gh.scopes", "gist, read:org, repo");
    const [before] = await connections.states(["github"]);
    expect(before).toMatchObject({ signedIn: true, missingScopes: ["workflow"] });
    expect(before?.message).toContain("without the workflow permission");
    const login = await connections.startLogin("github");
    const shown = await waiting(login.id);
    expect(shown.url).toBe("https://github.com/login/device");
    expect(shown.code).toBe("ABCD-1234");
    expect(fakes.seen("gh")?.args).toBe("auth refresh --hostname github.com --scopes workflow");
    fakes.approve();
    expect((await settled(login.id)).status).toBe("done");
    expect((await connections.states(["github"]))[0]?.missingScopes).toEqual([]);
  });

  it("signs in to GitHub and Vercel with their own logins", async () => {
    fakes.setMode("login_ok");
    const gh = await waiting((await connections.startLogin("github")).id);
    expect(gh).toMatchObject({ url: "https://github.com/login/device", code: "ABCD-1234" });
    expect(fakes.seen("gh")?.args).toContain("auth login --hostname github.com");
    const vercel = await waiting((await connections.startLogin("vercel")).id);
    expect(vercel.url).toBe("https://vercel.com/oauth/device?user_code=VRCL-9876");
    expect(vercel.code).toBe("VRCL-9876");
    expect(fakes.seen("npx")?.args).toBe("--yes vercel@66.6.0 login");
  });

  it("starts one login when two requests arrive together", async () => {
    fakes.setMode("login_hang");
    const [a, b] = await Promise.all([
      connections.startLogin("github"),
      connections.startLogin("github"),
    ]);
    expect(a.id).toBe(b.id);
    await waiting(a.id);
    expect(fakes.calls().filter((c) => c.startsWith("gh auth login"))).toHaveLength(1);
  });

  it("says gh is missing with the install command, and starts nothing", async () => {
    const noGh = makeFakeClis(["npx"]);
    // Only the fakes' folder on PATH: CI's Linux runner has a real gh in /usr/bin, which the
    // fakes' usual PATH includes. It must not be found, and never asked, here.
    const s = service({ fakes: noGh, path: noGh.dir });
    const [github] = await s.states(["github"]);
    expect(github).toMatchObject({ cli: "missing", signedIn: null });
    expect(github?.install).toBeTruthy();
    await expect(s.startLogin("github")).rejects.toBeInstanceOf(ServiceError);
    s.dispose();
    await removeTree(noGh.dir);
  });

  it("never runs a command that isn't one of the fixed ones", async () => {
    fakes.setMode("signed_in");
    await connections.states(["convex", "doppler", "github", "vercel"]);
    const allowed = [
      "npx --yes convex@1.43.0 login status",
      "doppler me --json",
      "gh auth status --json hosts",
      "gh api user/orgs --jq .[].login",
      "npx --yes vercel@66.6.0 whoami --json",
      "npx --yes vercel@66.6.0 teams list --json",
    ];
    expect([...new Set(fakes.calls())].sort()).toEqual([...allowed].sort());
  });
});

describe("the Connections routes are for this computer only", () => {
  const calls: string[] = [];
  const stub = {
    // The route asks the service, which adds the last deploy's owner to what the CLIs answered.
    connectionStates: (services: string[]) => stub.connections.states(services),
    connections: {
      states: async (services: string[]) => {
        calls.push(`states:${services.join(",")}`);
        return [];
      },
      startLogin: (s: string) => {
        calls.push(`login:${s}`);
        return { id: "l1", service: s, status: "starting", url: null, code: null, message: "" };
      },
      login: (id: string) => ({
        id,
        service: "convex",
        status: "waiting",
        url: null,
        code: null,
        message: "",
      }),
      cancel: (id: string) => ({
        id,
        service: "convex",
        status: "cancelled",
        url: null,
        code: null,
        message: "",
      }),
    },
  };
  const app = new Hono()
    .onError((e, c) => errorResponse(e, c))
    .route("/", secureFoundationRoutes({ secureFoundation: stub } as unknown as AppServices));
  const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
  const ROUTES: Array<[string, string]> = [
    ["GET", "/connections?services=convex,doppler"],
    ["POST", "/connections/convex/login"],
    ["GET", "/connections/logins/l1"],
    ["DELETE", "/connections/logins/l1"],
  ];

  it.each(ROUTES)("%s %s is refused to another device and starts nothing", async (method, path) => {
    const before = calls.length;
    const res = await app.request(path, { method }, from("192.168.1.20"));
    expect(res.status).toBe(403);
    expect(calls.length).toBe(before);
  });

  it.each(ROUTES)("%s %s works on this computer", async (method, path) => {
    const res = await app.request(path, { method }, from("127.0.0.1"));
    expect(res.status).toBeLessThan(300);
  });

  it("refuses a service it doesn't know, and a list with one", async () => {
    const local = from("127.0.0.1");
    expect((await app.request("/connections/npm/login", { method: "POST" }, local)).status).toBe(
      403,
    );
    expect((await app.request("/connections?services=convex,ssh", {}, local)).status).toBe(400);
    expect((await app.request("/connections", {}, local)).status).toBe(400);
  });
});
