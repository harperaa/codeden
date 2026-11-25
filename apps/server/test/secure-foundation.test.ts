import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CreateSecureFoundationRequest,
  type Project,
  type ProviderInfo,
  SECURE_FOUNDATION_SETUP_AUTONOMY,
  SECURE_FOUNDATION_WORK_KEY,
  type StartSessionRequestInit,
  VerifySecureFoundationRequest,
} from "@codeden/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/services/errors";
import { type Exec, runTool } from "../src/services/exec";
import {
  isOwnFolder,
  removeCreated,
  type SecureFoundationDeps,
  SecureFoundationService,
} from "../src/services/secure-foundation/secure-foundation-service";
import { SecureFoundationSetups } from "../src/services/secure-foundation/setups";
import { removeTree } from "./support/remove-tree";
import { makeTemplateFixture, type TemplateFixture } from "./support/secure-foundation-fixture";

/**
 * Creating a project from the template, against a local fixture repository and real git, with
 * the project list and the session start scripted. No network, no provider.
 */
const EMAIL = "person@site.test";
const capabilities = { projectCommands: true } as ProviderInfo["capabilities"];
const provider = (id: string, extra: Partial<ProviderInfo["capabilities"]> = {}): ProviderInfo => ({
  id,
  displayName: id.toUpperCase(),
  capabilities: { ...capabilities, ...extra },
  models: [],
});
const check = (id: string, loggedIn: boolean | null, installed = true) =>
  ({ id, installed, loggedIn }) as never;

let fixture: TemplateFixture;
let dir: string;
let projectsDir: string;
let created: Array<{ path: string; name?: string }>;
let archived: string[];
let started: StartSessionRequestInit[];
/** What was asked of the scripted deps, in order: the project, its mode, the session. */
let order: string[];
let failAt: "project" | "mode" | "session" | null;

beforeAll(() => {
  fixture = makeTemplateFixture();
});
afterAll(() => removeTree(fixture.root));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sf-test-"));
  projectsDir = join(dir, "projects");
  created = [];
  archived = [];
  started = [];
  order = [];
  failAt = null;
});
afterEach(() => removeTree(dir));

function service(over: Partial<SecureFoundationDeps> = {}) {
  return new SecureFoundationService({
    exec: runTool,
    template: fixture.source,
    projectsDir,
    tmpDir: dir,
    providers: () => [provider("alpha"), provider("beta", { projectCommands: false })],
    preferredProvider: () => null,
    setupStatus: async () => ({ checks: [check("alpha", true), check("beta", true)] }),
    projects: {
      async create(req) {
        if (failAt === "project") throw new Error("database is closed");
        if (req.source.type !== "local") throw new Error("expected a local folder");
        created.push({ path: req.source.path, name: req.name });
        order.push("project");
        return { project: { id: "p1", path: req.source.path, name: req.name } as Project } as never;
      },
      get: () =>
        ({
          id: "p1",
          path: join(projectsDir, "my-site"),
          name: created[0]?.name,
          autonomyMode: order.includes("mode:manual") ? "manual" : "assisted",
        }) as Project,
      archive: (id) => void archived.push(id),
    },
    async setProjectMode(_id, mode) {
      if (failAt === "mode") throw new Error("database is closed");
      order.push(`mode:${mode}`);
    },
    async startSession(req) {
      if (failAt === "session") throw new Error("no runner");
      order.push("session");
      started.push(req);
      return { status: "started", sessionId: "s1" };
    },
    ...over,
  });
}

const request = (over: Record<string, unknown> = {}) =>
  CreateSecureFoundationRequest.parse({
    name: "My Site",
    adminEmail: EMAIL,
    provider: "alpha",
    commit: fixture.head(),
    ...over,
  });

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

const failure = async (run: Promise<unknown>): Promise<ServiceError> => {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ServiceError);
  return error as ServiceError;
};

describe("resolving the template", () => {
  it("reports the branch's commit, its date and the content modules it has", async () => {
    const template = await service().template();
    expect(template.commit).toBe(fixture.head());
    expect(template.repository).toBe("fixture/template");
    expect(Number.isNaN(Date.parse(template.committedAt))).toBe(false);
    expect(template.modules).toEqual([
      { name: "blog", title: "Blog", description: "A blog" },
      { name: "pricing", title: "Pricing", description: "A pricing page" },
    ]);
    // Nothing of the fetch is left in the temp folder.
    expect(readdirSync(dir)).toEqual([]);
  });

  it("is refused when the build has no template", async () => {
    const off = service({ template: null });
    expect((await off.options()).enabled).toBe(false);
    expect((await off.options()).providers).toEqual([]);
    expect((await failure(off.template())).code).toBe("secure_foundation_off");
    expect((await failure(off.create(request()))).code).toBe("secure_foundation_off");
  });
});

describe("creating the project", () => {
  it("writes a fresh repository: one commit, no remote, none of the template's history", async () => {
    const commit = fixture.head();
    const result = await service().create(request());
    const dest = join(projectsDir, "my-site");
    expect(result).toMatchObject({ sessionId: "s1", commit });
    expect(created).toEqual([{ path: dest, name: "My Site" }]);
    expect(git(dest, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(dest, "remote")).toBe("");
    expect(git(dest, "rev-parse", "HEAD")).not.toBe(commit);
    expect(git(dest, "log", "--format=%s")).toContain(commit.slice(0, 7));
    expect(git(dest, "status", "--porcelain")).toBe("");
    expect(git(dest, "branch", "--show-current")).toBe("main");
    // The files are the confirmed commit's.
    expect(existsSync(join(dest, ".claude/commands/install.md"))).toBe(true);
    expect(existsSync(join(dest, "CHANGES.md"))).toBe(false);
    expect(readdirSync(dir)).toEqual(["projects"]);
  });

  it("starts the setup session in the project folder, unattended, on the chosen provider", async () => {
    await service().create(request());
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      projectId: "p1",
      provider: "alpha",
      autonomy: SECURE_FOUNDATION_SETUP_AUTONOMY,
      workspace: { mode: "repo_root" },
      workKey: SECURE_FOUNDATION_WORK_KEY,
      title: "Secure Foundation setup",
      purpose: "Secure Foundation setup",
    });
    // The email goes to the install (the brief) and nowhere else in the request.
    const { input, ...rest } = started[0] as StartSessionRequestInit;
    expect(input?.text).toContain(EMAIL);
    expect(JSON.stringify(rest)).not.toContain(EMAIL);
    expect(JSON.stringify(created)).not.toContain(EMAIL);
  });

  it("puts the new project in Manual mode before its setup session starts", async () => {
    const result = await service().create(request());
    expect(order).toEqual(["project", "mode:manual", "session"]);
    expect(result.project).toMatchObject({ id: "p1", name: "My Site", autonomyMode: "manual" });
  });

  it("refuses when the branch moved after the person confirmed, and leaves nothing", async () => {
    const confirmed = fixture.head();
    const now = fixture.advance();
    const error = await failure(service().create(request({ commit: confirmed })));
    expect(error.status).toBe(409);
    expect(error.code).toBe("template_moved");
    expect(error.message).toContain(now.slice(0, 7));
    expect(existsSync(join(projectsDir, "my-site"))).toBe(false);
    expect(created).toEqual([]);
    // Confirming the new commit works.
    await service().create(request({ commit: now }));
    expect(existsSync(join(projectsDir, "my-site", "CHANGES.md"))).toBe(true);
  });

  it("refuses a folder that already holds something, and doesn't touch it", async () => {
    const dest = join(projectsDir, "my-site");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "keep.txt"), "mine\n");
    const error = await failure(service().create(request()));
    expect(error.code).toBe("destination_exists");
    expect(readdirSync(dest)).toEqual(["keep.txt"]);
    expect(started).toEqual([]);
  });

  it("refuses a file of that name too", async () => {
    mkdirSync(projectsDir, { recursive: true });
    writeFileSync(join(projectsDir, "my-site"), "a file\n");
    expect((await failure(service().create(request()))).code).toBe("destination_exists");
  });

  it("refuses a link of that name and leaves what it points at alone", async () => {
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(projectsDir, { recursive: true });
    symlinkSync(elsewhere, join(projectsDir, "my-site"), "dir");
    expect((await failure(service().create(request()))).code).toBe("destination_exists");
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(started).toEqual([]);
  });

  it("never cleans up through a link put where the new folder was", () => {
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "keep.txt"), "mine\n");
    mkdirSync(projectsDir, { recursive: true });
    const link = join(projectsDir, "swapped");
    symlinkSync(elsewhere, link, "dir");
    expect(isOwnFolder(link)).toBe(false);
    removeCreated(link, true);
    removeCreated(link, false);
    expect(readdirSync(elsewhere)).toEqual(["keep.txt"]);
    expect(existsSync(link)).toBe(true);
    // A folder of its own is removed, or emptied when it was there before.
    const own = join(projectsDir, "own");
    mkdirSync(join(own, "sub"), { recursive: true });
    expect(isOwnFolder(own)).toBe(true);
    removeCreated(own, true);
    expect(readdirSync(own)).toEqual([]);
    removeCreated(own, false);
    expect(existsSync(own)).toBe(false);
  });

  it("removes the folder when adding the project fails, and says which step", async () => {
    failAt = "project";
    const error = await failure(service().create(request()));
    expect(error.code).toBe("project_failed");
    expect(error.message).toContain("adding the project");
    expect(existsSync(join(projectsDir, "my-site"))).toBe(false);
    expect(archived).toEqual([]);
  });

  it("archives the project and removes the folder when its mode can't be set", async () => {
    failAt = "mode";
    const error = await failure(service().create(request()));
    expect(error.code).toBe("project_failed");
    expect(archived).toEqual(["p1"]);
    expect(started).toEqual([]);
    expect(existsSync(join(projectsDir, "my-site"))).toBe(false);
  });

  it("archives the project and removes the folder when the session can't start", async () => {
    failAt = "session";
    const error = await failure(service().create(request()));
    expect(error.code).toBe("session_failed");
    expect(archived).toEqual(["p1"]);
    expect(existsSync(join(projectsDir, "my-site"))).toBe(false);
  });

  it("empties, but keeps, an empty folder that was already there", async () => {
    const dest = join(projectsDir, "my-site");
    mkdirSync(dest, { recursive: true });
    failAt = "session";
    await failure(service().create(request()));
    expect(readdirSync(dest)).toEqual([]);
  });

  it("names the fetch when the template can't be reached", async () => {
    const gone = { ...fixture.source, url: join(dir, "nowhere") };
    const error = await failure(service({ template: gone }).create(request()));
    expect(error.code).toBe("fetch_failed");
    expect(existsSync(join(projectsDir, "my-site"))).toBe(false);
  });

  it("refuses a provider that isn't signed in", async () => {
    const signedOut = service({
      setupStatus: async () => ({ checks: [check("alpha", false), check("beta", true)] }),
    });
    expect((await signedOut.options()).providers.map((p) => p.id)).toEqual(["beta"]);
    expect((await failure(signedOut.create(request()))).code).toBe("provider_unavailable");
    expect(existsSync(projectsDir)).toBe(false);
  });

  it("refuses a module the template doesn't have", async () => {
    const error = await failure(
      service().create(request({ shell: "pick", modules: ["blog", "nope"] })),
    );
    expect(error.code).toBe("unknown_module");
    expect(existsSync(join(projectsDir, "my-site"))).toBe(false);
  });

  it("gives the setup session the confirmed repository, owner and scope, and no other", async () => {
    const deploy = { owner: "acme-org", repository: "my-site", vercelScope: "acme-team" };
    await service().create(request({ deploy }));
    const text = started[0]?.input?.text ?? "";
    expect(text).toContain("GitHub repository: acme-org/my-site, private");
    expect(text).toContain('--repo-name="my-site" --owner="acme-org"');
    expect(text).toContain('--scope="acme-team"');
    // Without the option the session is told not to create or deploy anything.
    started = [];
    await service({ projectsDir: join(dir, "other") }).create(request());
    expect(started[0]?.input?.text).toContain("Don't create a GitHub repository");
    expect(started[0]?.input?.text).not.toContain("deploy-to-dev");
  });

  it.each([
    ["an owner that is a path", { owner: "../x", repository: "a", vercelScope: "t" }],
    ["a repository name with a space", { owner: "a", repository: "a b", vercelScope: "t" }],
    ["shell text as the repository", { owner: "a", repository: 'x";id;"', vercelScope: "t" }],
    [
      "a public repository",
      { owner: "a", repository: "a", vercelScope: "t", visibility: "public" },
    ],
    ["a scope with an option in it", { owner: "a", repository: "a", vercelScope: "--prod" }],
  ])("the request schema refuses %s", (_label, deploy) => {
    const parsed = CreateSecureFoundationRequest.safeParse({
      name: "x",
      adminEmail: EMAIL,
      provider: "alpha",
      commit: "a".repeat(40),
      deploy,
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps the template's history and remote in clone mode", async () => {
    await service({ repositoryMode: "clone" }).create(request());
    const dest = join(projectsDir, "my-site");
    expect(git(dest, "rev-parse", "HEAD")).toBe(fixture.head());
    expect(git(dest, "remote")).toBe("origin");
  });
});

describe("verifying before Go", () => {
  const form = (over: Record<string, unknown> = {}) =>
    VerifySecureFoundationRequest.parse({
      name: "My Site",
      adminEmail: EMAIL,
      secrets: "doppler",
      shell: "all",
      provider: "alpha",
      ...over,
    });
  const status = async (run: ReturnType<SecureFoundationService["verify"]>) =>
    Object.fromEntries((await run).checks.map((c) => [c.id, c.status]));

  it("passes every check, resolves the commit, and writes and starts nothing", async () => {
    const result = await service().verify(form());
    expect(result.checks.map((c) => [c.id, c.status])).toEqual([
      ["fields", "passed"],
      ["folder", "passed"],
      ["template", "passed"],
      ["provider", "passed"],
    ]);
    expect(result.template?.commit).toBe(fixture.head());
    expect(result.checks[1]?.message).toContain(join(projectsDir, "my-site"));
    expect(result.checks[2]?.message).toContain(fixture.head().slice(0, 7));
    // Read-only: not even the projects folder is made, and the fetch is gone.
    expect(readdirSync(dir)).toEqual([]);
    expect(created).toEqual([]);
    expect(started).toEqual([]);
  });

  it("fails the fields the server wouldn't take, without repeating them", async () => {
    const bad = form({ name: "../x", adminEmail: "admin@example.com", secrets: "vault" });
    const result = await service().verify(bad);
    expect(await status(Promise.resolve(result))).toMatchObject({
      fields: "failed",
      folder: "failed",
      template: "passed",
      provider: "passed",
    });
    const text = JSON.stringify(result.checks);
    expect(text).toContain("project name");
    expect(text).toContain("admin email");
    expect(text).toContain("secrets choice");
    expect(text).not.toContain("admin@example.com");
    expect(text).not.toContain("../x");
    for (const check of result.checks.filter((c) => c.status !== "passed")) {
      expect(check.fix).toBeTruthy();
    }
  });

  it("fails a folder that holds something, a file or a link of that name; an empty one passes", async () => {
    const dest = join(projectsDir, "my-site");
    mkdirSync(dest, { recursive: true });
    expect((await status(service().verify(form()))).folder).toBe("passed");
    writeFileSync(join(dest, "keep.txt"), "mine\n");
    const taken = await service().verify(form());
    expect(taken.checks[1]).toMatchObject({ id: "folder", status: "failed" });
    expect(taken.checks[1]?.message).toContain("already exists");
    expect(readdirSync(dest)).toEqual(["keep.txt"]);
    writeFileSync(join(projectsDir, "a-file"), "x\n");
    expect((await status(service().verify(form({ name: "A File" })))).folder).toBe("failed");
    symlinkSync(join(dir, "elsewhere"), join(projectsDir, "linked"), "dir");
    expect((await status(service().verify(form({ name: "Linked" })))).folder).toBe("failed");
  });

  it("fails a provider that isn't signed in, and a template that can't be reached", async () => {
    const signedOut = service({
      setupStatus: async () => ({ checks: [check("alpha", false), check("beta", true)] }),
    });
    expect((await status(signedOut.verify(form()))).provider).toBe("failed");
    const gone = service({ template: { ...fixture.source, url: join(dir, "nowhere") } });
    const result = await gone.verify(form());
    expect(result.template).toBeNull();
    expect(result.checks[2]).toMatchObject({ id: "template", status: "failed" });
    expect(result.checks[2]?.fix).toContain("check again");
  });

  it("fails a picked module the template doesn't have, and each part of a deploy that is wrong", async () => {
    const pick = form({ shell: "pick", modules: ["blog", "nope"] });
    expect((await status(service().verify(pick))).template).toBe("failed");
    const ok = form({ deploy: { repository: "my-site" } });
    expect((await status(service().verify(ok))).fields).toBe("passed");
    const bad = form({ deploy: { owner: "../x", repository: "a b", vercelScope: "--prod" } });
    const result = await service().verify(bad);
    expect(result.checks[0]?.status).toBe("failed");
    expect(result.checks[0]?.message).toContain("repository owner");
    expect(result.checks[0]?.message).toContain("Vercel scope");
  });

  it("is refused when the build has no template", async () => {
    expect((await failure(service({ template: null }).verify(form()))).code).toBe(
      "secure_foundation_off",
    );
  });

  it("doesn't stand in for create's own checks: a create that skips it is still refused", async () => {
    const dest = join(projectsDir, "my-site");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "keep.txt"), "mine\n");
    expect((await failure(service().create(request()))).code).toBe("destination_exists");
    expect(
      (await failure(service().create(request({ name: "Other", commit: "a".repeat(40) })))).code,
    ).toBe("template_moved");
    expect(started).toEqual([]);
    expect(readdirSync(projectsDir)).toEqual(["my-site"]);
  });
});

describe("the default app shell", () => {
  const INSTALL = "node scripts/modules.mjs install blog pricing --apply-edits";

  it("is every module, with the same install command All modules always gave", async () => {
    // A request that names no shell gets the default.
    await service().create(request());
    const byDefault = started[0]?.input?.text ?? "";
    expect(byDefault).toContain(INSTALL);
    expect(byDefault).toContain("- Content modules to install (`<MODULES>`): blog pricing");
    expect(byDefault).toContain("- Content modules skipped (`<SKIPPED_MODULES>`): none");
    // Asking for "all" by name gives the same brief, commands and flags.
    started = [];
    await service({ projectsDir: join(dir, "other") }).create(request({ shell: "all" }));
    expect(started[0]?.input?.text).toBe(byDefault);
  });

  it("still installs none when Minimal is chosen", async () => {
    await service().create(request({ shell: "minimal" }));
    expect(started[0]?.input?.text).not.toContain("scripts/modules.mjs install");
    expect(started[0]?.input?.text).toContain("none (minimal shell)");
  });
});

describe("names and paths", () => {
  it.each([
    "../escape",
    "..",
    ".hidden",
    "a/b",
    "a\\b",
    "-rf",
    "x\u0000y",
    "",
    "   ",
    "a".repeat(61),
    "$(id)",
    "name;rm",
  ])("the request schema refuses the name %j", (name) => {
    expect(
      CreateSecureFoundationRequest.safeParse({
        name,
        adminEmail: EMAIL,
        provider: "alpha",
        commit: "a".repeat(40),
      }).success,
    ).toBe(false);
  });

  it("always creates a direct child of the projects folder", async () => {
    await service().create(request({ name: "Shop 2.0 _beta_" }));
    expect(readdirSync(projectsDir)).toEqual(["shop-2-0-beta"]);
  });

  it("refuses a commit that isn't a full commit id, and a request that names a URL", () => {
    const base = { name: "x", adminEmail: EMAIL, provider: "alpha" };
    expect(CreateSecureFoundationRequest.safeParse({ ...base, commit: "main" }).success).toBe(
      false,
    );
    const parsed = CreateSecureFoundationRequest.parse({
      ...base,
      commit: "a".repeat(40),
      url: "https://example.org/other.git",
    });
    expect(parsed).not.toHaveProperty("url");
  });
});

describe("providers", () => {
  it("lists signed-in providers, the configured one first, then those that run command files", async () => {
    const list = (preferred: string | null) =>
      service({
        providers: () => [
          provider("plain", { projectCommands: false }),
          provider("runs"),
          provider("free", { projectCommands: false, credentialFree: true }),
          provider("out"),
          provider("unknown"),
        ],
        preferredProvider: () => preferred,
        setupStatus: async () => ({
          checks: [check("plain", null), check("runs", true), check("out", false)],
        }),
      }).providers();
    expect((await list(null)).map((p) => p.id)).toEqual(["runs", "plain", "free"]);
    expect((await list("free")).map((p) => p.id)).toEqual(["free", "runs", "plain"]);
    expect((await list(null))[0]).toMatchObject({ runsCommandFiles: true });
  });
});

describe("prefill", () => {
  const withEmail =
    (stdout: string, code = 0): Exec =>
    async () => ({ code, stdout, stderr: "", notFound: false, timedOut: false, path: "git" });

  it("suggests git's own email", async () => {
    expect(await service({ exec: withEmail(`${EMAIL}\n`) }).prefill()).toEqual({
      adminEmail: EMAIL,
    });
  });

  it.each([
    ["nothing configured", withEmail("", 1)],
    ["something that isn't an email", withEmail("not an address\n")],
    ["a placeholder the install refuses", withEmail("admin@example.com\n")],
    [
      "a source that fails",
      (async () => {
        throw new Error("spawn failed");
      }) as Exec,
    ],
  ])("gives null with %s", async (_label, exec) => {
    expect(await service({ exec }).prefill()).toEqual({ adminEmail: null });
  });

  it("creates nothing and starts nothing", async () => {
    await service({ exec: withEmail(EMAIL) }).prefill();
    expect(created).toEqual([]);
    expect(started).toEqual([]);
    expect(existsSync(projectsDir)).toBe(false);
  });
});

describe("the finish state", () => {
  it("reads the Clerk claim link from the install's summary, and only a Clerk link", () => {
    const dest = join(projectsDir, "my-site");
    mkdirSync(join(dest, "docs"), { recursive: true });
    const s = service();
    expect(s.finish("p1")).toEqual({ clerkClaimUrl: null, deployedUrl: null });
    const url = "https://dashboard.clerk.com/apps/claim?token=fixture";
    writeFileSync(join(dest, "docs/INSTALL.md"), `## Claim Your Clerk App\n\nVisit: ${url}\n`);
    expect(s.finish("p1")).toEqual({ clerkClaimUrl: url, deployedUrl: null });
    writeFileSync(join(dest, "docs/INSTALL.md"), "Visit: https://clerk.com.evil.test/claim\n");
    expect(s.finish("p1")).toEqual({ clerkClaimUrl: null, deployedUrl: null });
    // The deployed site, from the deploy's own summary: a vercel.app address only.
    writeFileSync(
      join(dest, "docs/DEPLOYMENT-DEV.md"),
      "# Deployment\n\n- GitHub: https://github.com/acme-org/my-site\n- **App:** https://my-site.vercel.app/dashboard\n",
    );
    expect(s.finish("p1").deployedUrl).toBe("https://my-site.vercel.app");
    writeFileSync(join(dest, "docs/DEPLOYMENT-DEV.md"), "App: https://vercel.app.evil.test/x\n");
    expect(s.finish("p1").deployedUrl).toBeNull();
  });
});

describe("what a dev preview of the new project depends on", () => {
  const home = () => join(dir, "home");
  const notAsked = { setUp: () => false, baseCheckout: null };

  it("keeps the secrets mode and the Doppler names of the confirmed form, and nothing else", async () => {
    const s = service({ setups: new SecureFoundationSetups(home()) });
    await s.create(request());
    const file = join(home(), "secure-foundation.json");
    const kept = JSON.parse(readFileSync(file, "utf8"));
    expect(kept).toEqual({
      projects: {
        p1: {
          secrets: "doppler",
          doppler: { project: "my-site", config: "dev" },
          createdAt: expect.any(String),
        },
      },
    });
    expect(readFileSync(file, "utf8")).not.toContain(EMAIL);
    // The form values come from what was kept, without asking for the setup session.
    const offer = s.devPreview("p1", {
      setUp: () => {
        throw new Error("not needed");
      },
      baseCheckout: null,
    });
    expect(offer.settings?.command).toBe(
      "doppler run --project my-site --config dev -- npm run dev",
    );
    expect(offer.settings?.prepareCommand).toBe("npm ci");
    // Creating a project and offering values sets no dev preview up: only the dev preview's
    // own settings do, and nothing was written to them.
    expect(readdirSync(home())).toEqual(["secure-foundation.json"]);
  });

  it("offers the plain dev command for a project without Doppler", async () => {
    const s = service({ setups: new SecureFoundationSetups(home()) });
    await s.create(request({ secrets: "env_local" }));
    const offer = s.devPreview("p1", { setUp: () => false, baseCheckout: "/base/my-site" });
    expect(offer.secrets).toBe("env_local");
    expect(offer.settings?.command).toBe("npm run dev");
    expect(offer.notes.join(" ")).toContain("`/base/my-site`");
  });

  it("reads what was kept again after a restart, and skips an entry it can't read", async () => {
    await service({ setups: new SecureFoundationSetups(home()) }).create(request());
    const file = join(home(), "secure-foundation.json");
    const kept = JSON.parse(readFileSync(file, "utf8"));
    kept.projects.p2 = { secrets: "vault" };
    writeFileSync(file, JSON.stringify(kept));
    const again = new SecureFoundationSetups(home());
    expect(again.get("p1")?.doppler).toEqual({ project: "my-site", config: "dev" });
    expect(again.get("p2")).toBeNull();
    expect(service({ setups: again }).devPreview("p2", notAsked).applies).toBe(false);
  });

  it("remembers the last deploy's GitHub owner and offers it while the account can still use it", async () => {
    const setups = new SecureFoundationSetups(home());
    expect(setups.lastDeployOwner()).toBeNull();
    setups.record("p1", { name: "My Site", secrets: "doppler" }, new Date());
    expect(setups.lastDeployOwner()).toBeNull();
    setups.record(
      "p2",
      { name: "Other", secrets: "env_local", deploy: { owner: "acme-org" } },
      new Date(),
    );
    // A setup without the deploy leaves the last owner as it was; a restart reads it again.
    setups.record("p3", { name: "Third", secrets: "env_local" }, new Date());
    const again = new SecureFoundationSetups(home());
    expect(again.lastDeployOwner()).toBe("acme-org");
    expect(again.get("p1")?.secrets).toBe("doppler");
    // Something that isn't an owner name is never offered.
    const file = join(home(), "secure-foundation.json");
    writeFileSync(file, JSON.stringify({ projects: {}, lastDeployOwner: "../x" }));
    expect(new SecureFoundationSetups(home()).lastDeployOwner()).toBeNull();

    const github = (owners: string[]) => ({
      service: "github" as const,
      cli: "ready" as const,
      signedIn: true,
      message: "Signed in to GitHub.",
      install: null,
      teams: [],
      account: owners[0] ?? null,
      owners,
      lastOwner: null,
      missingScopes: [],
      scopes: [],
    });
    let owners = ["octo", "acme-org"];
    const connections = {
      states: async () => [github(owners), { ...github([]), service: "convex" as const }],
    } as unknown as SecureFoundationDeps["connections"];
    const s = service({ setups: again, connections });
    const [gh, convex] = await s.connectionStates(["github", "convex"]);
    expect(gh?.lastOwner).toBe("acme-org");
    expect(convex?.lastOwner).toBeNull();
    // An organisation the account no longer belongs to isn't offered: the account is preselected.
    owners = ["octo"];
    expect((await s.connectionStates(["github"]))[0]?.lastOwner).toBeNull();
  });

  it("keeps nothing for a create that failed", async () => {
    failAt = "session";
    const setups = new SecureFoundationSetups(home());
    await expect(service({ setups }).create(request())).rejects.toThrow();
    expect(setups.get("p1")).toBeNull();
    expect(existsSync(join(home(), "secure-foundation.json"))).toBe(false);
  });

  it("doesn't fail the setup when it can't be kept", async () => {
    // The home is a file: nothing can be written inside it.
    writeFileSync(home(), "not a folder");
    const s = service({ setups: new SecureFoundationSetups(home()) });
    const made = await s.create(request());
    expect(made.sessionId).toBe("s1");
    expect(archived).toEqual([]);
    // Until the app restarts it still knows; after that the project counts as made earlier.
    expect(s.devPreview("p1", notAsked).secrets).toBe("doppler");
    expect(new SecureFoundationSetups(home()).get("p1")).toBeNull();
  });

  it("is nothing for a project Secure Foundation didn't set up", () => {
    const s = service({ setups: new SecureFoundationSetups(home()) });
    expect(s.devPreview("p-other", notAsked)).toEqual({
      applies: false,
      secrets: null,
      settings: null,
      notes: [],
      convex: null,
    });
  });

  it("offers the plain command to a project set up before anything was kept", () => {
    const offer = service().devPreview("p1", { setUp: () => true, baseCheckout: null });
    expect(offer.applies).toBe(true);
    expect(offer.secrets).toBeNull();
    expect(offer.settings?.command).toBe("npm run dev");
  });
});
