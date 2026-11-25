import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CreateSecureFoundationRequest,
  CreateSecureFoundationResponse,
  HARDEN_TEMPLATE_BRANCH,
  HARDEN_TEMPLATE_REPOSITORY,
  hardenTemplateUrl,
  isSecureFoundationQuiet,
  isSecureFoundationSetup,
  ProviderCapabilities,
  SECURE_FOUNDATION_DEFAULT_DEPLOY,
  SECURE_FOUNDATION_DEFAULT_SECRETS,
  SECURE_FOUNDATION_DEFAULT_SHELL,
  SECURE_FOUNDATION_OPT_IN_MODE,
  SECURE_FOUNDATION_PROJECT_MODE,
  SECURE_FOUNDATION_REPOSITORY_MODE,
  SECURE_FOUNDATION_SETUP_AUTONOMY,
  SECURE_FOUNDATION_WORK_KEY,
  SecureFoundationEmail,
  SecureFoundationFinish,
  SecureFoundationName,
  SecureFoundationOptions,
  SecureFoundationPrefill,
  SecureFoundationQuiet,
  SecureFoundationTemplate,
  type Session,
  secureFoundationCreates,
  secureFoundationCreatesLine,
  secureFoundationFolder,
  secureFoundationStatus,
  VerifySecureFoundationRequest,
  VerifySecureFoundationResponse,
  WorkKey,
} from "../src/index";
import { sampleProject } from "./fixtures";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const roundTrip = <T>(schema: { parse: (v: unknown) => T }, value: unknown): T =>
  schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));

type Globals = {
  __CODEHARDEN_TEMPLATE_REPOSITORY__?: string;
  __CODEHARDEN_TEMPLATE_BRANCH__?: string;
};
const globals = globalThis as Globals;
afterEach(() => {
  delete globals.__CODEHARDEN_TEMPLATE_REPOSITORY__;
  delete globals.__CODEHARDEN_TEMPLATE_BRANCH__;
  vi.resetModules();
});

describe("the template in the fork's configuration", () => {
  it("defaults to the Secure Vibe Coding OS on main", () => {
    expect(HARDEN_TEMPLATE_REPOSITORY).toBe("harperaa/secure-vibe-coding-OS");
    expect(HARDEN_TEMPLATE_BRANCH).toBe("main");
    expect(hardenTemplateUrl()).toBe("https://github.com/harperaa/secure-vibe-coding-OS.git");
  });

  it("takes a fork's own template, and an empty one switches the option off", async () => {
    globals.__CODEHARDEN_TEMPLATE_REPOSITORY__ = "acme/starter";
    globals.__CODEHARDEN_TEMPLATE_BRANCH__ = "stable";
    vi.resetModules();
    const own = await import("../src/index");
    expect(own.hardenTemplateUrl()).toBe("https://github.com/acme/starter.git");
    expect(own.HARDEN_TEMPLATE_BRANCH).toBe("stable");
    globals.__CODEHARDEN_TEMPLATE_REPOSITORY__ = "";
    vi.resetModules();
    const off = await import("../src/index");
    expect(off.HARDEN_TEMPLATE_REPOSITORY).toBe("");
    expect(off.hardenTemplateUrl()).toBeNull();
  });

  it("falls back to the default when the injected value is not an owner/repo", async () => {
    globals.__CODEHARDEN_TEMPLATE_REPOSITORY__ = "https://example.org/x.git";
    globals.__CODEHARDEN_TEMPLATE_BRANCH__ = "../other";
    vi.resetModules();
    const built = await import("../src/index");
    expect(built.HARDEN_TEMPLATE_REPOSITORY).toBe("harperaa/secure-vibe-coding-OS");
    expect(built.HARDEN_TEMPLATE_BRANCH).toBe("main");
  });
});

describe("the defaults a fork owner can flip", () => {
  it("are Doppler, an unattended session, a fresh repository and every module", () => {
    expect(SECURE_FOUNDATION_DEFAULT_SECRETS).toBe("doppler");
    expect(SECURE_FOUNDATION_SETUP_AUTONOMY).toBe("full");
    expect(SECURE_FOUNDATION_REPOSITORY_MODE).toBe("fresh");
    expect(SECURE_FOUNDATION_DEFAULT_SHELL).toBe("all");
    // Nothing that creates more than before starts ticked.
    expect(SECURE_FOUNDATION_DEFAULT_DEPLOY).toBe(false);
    expect(WorkKey.safeParse(SECURE_FOUNDATION_WORK_KEY).success).toBe(true);
  });

  it("has a capability for running project command files", () => {
    expect(ProviderCapabilities.shape.projectCommands.safeParse(undefined).success).toBe(true);
  });
});

describe("the route shapes round-trip", () => {
  it("options, prefill, template, finish", () => {
    const options = {
      enabled: true,
      template: { repository: "acme/starter", branch: "main" },
      projectsDir: "/projects",
      pathSeparator: "/",
      providers: [{ id: "fake", displayName: "Fake", runsCommandFiles: false }],
      defaults: { secrets: "doppler", shell: "all", deploy: false },
      repositoryMode: "fresh",
      autonomy: "full",
    };
    expect(roundTrip(SecureFoundationOptions, options)).toEqual(options);
    expect(roundTrip(SecureFoundationPrefill, { adminEmail: null })).toEqual({ adminEmail: null });
    const template = {
      repository: "acme/starter",
      branch: "main",
      commit: COMMIT,
      committedAt: "2026-01-05T10:00:00.000Z",
      modules: [{ name: "blog", title: "Blog", description: "A blog" }],
    };
    expect(roundTrip(SecureFoundationTemplate, template)).toEqual(template);
    expect(roundTrip(SecureFoundationFinish, { clerkClaimUrl: null })).toEqual({
      clerkClaimUrl: null,
      deployedUrl: null,
    });
  });

  it("the request fills in the defaults and the response carries the project", () => {
    const request = roundTrip(CreateSecureFoundationRequest, {
      name: "  My Site ",
      adminEmail: " person@site.test ",
      provider: "fake",
      commit: COMMIT,
    });
    expect(request).toEqual({
      name: "My Site",
      adminEmail: "person@site.test",
      secrets: "doppler",
      shell: "all",
      modules: [],
      provider: "fake",
      commit: COMMIT,
    });
    const response = { project: sampleProject, sessionId: "s1", commit: COMMIT };
    expect(roundTrip(CreateSecureFoundationResponse, response)).toEqual(
      CreateSecureFoundationResponse.parse(response),
    );
  });
});

describe("names, folders and addresses", () => {
  it("makes a folder name that can't be a path", () => {
    expect(secureFoundationFolder("My Site")).toBe("my-site");
    expect(secureFoundationFolder("Shop 2.0 _beta_")).toBe("shop-2-0-beta");
    expect(secureFoundationFolder("a".repeat(60))).toHaveLength(40);
    expect(secureFoundationFolder(`${"a".repeat(39)} b`)).toBe("a".repeat(39));
    for (const name of ["My Site", "x", "A.B-c_d 9"]) {
      expect(SecureFoundationName.safeParse(name).success).toBe(true);
      expect(secureFoundationFolder(name)).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it("makes the folder name in one pass, whatever it is given", () => {
    expect(secureFoundationFolder("--a--b--")).toBe("a-b");
    expect(secureFoundationFolder("-".repeat(100_000))).toBe("");
    expect(secureFoundationFolder(`a${"-".repeat(100_000)}`)).toBe("a");
    expect(secureFoundationFolder("../../x")).toBe("x");
  });

  it("refuses names that are paths, hidden files or options", () => {
    for (const name of ["..", "../x", "a/b", "a\\b", ".env", "-x", "", "a:b", "é"]) {
      expect(SecureFoundationName.safeParse(name).success, name).toBe(false);
    }
  });

  it("accepts what the install accepts as an admin email", () => {
    expect(SecureFoundationEmail.safeParse("first.last+tag@mail.site.test").success).toBe(true);
    for (const bad of [
      "",
      "a@b",
      "a b@c.de",
      "admin@example.com",
      "USER@example.com",
      "a'b@c.de",
      "a`b@c.de",
    ]) {
      expect(SecureFoundationEmail.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("what a setup creates", () => {
  it("lists Clerk and Convex always, Doppler when chosen, with where to remove each", () => {
    const local = secureFoundationCreates({ name: "My Site", secrets: "env_local" });
    expect(local.map((c) => c.service)).toEqual(["Clerk", "Convex"]);
    const doppler = secureFoundationCreates({ name: "My Site", secrets: "doppler" });
    expect(doppler.map((c) => c.service)).toEqual(["Clerk", "Convex", "Doppler"]);
    expect(doppler[1]?.item).toContain('"my-site"');
    expect(doppler[2]?.item).toContain('"my-site"');
    for (const created of doppler) expect(created.removeAt.length).toBeGreaterThan(10);
  });
});

describe("the status of a setup, from its session", () => {
  const session = (
    status: Session["status"],
    text: string | null = null,
    extra: Partial<Session> = {},
  ) =>
    ({
      status,
      progress:
        text === null
          ? null
          : { text: `Secure Foundation: ${text}`, at: "2026-01-05T10:00:00.000Z" },
      archivedAt: null,
      startError: null,
      ...extra,
    }) as Session;
  const phase = (...args: Parameters<typeof session>) => secureFoundationStatus(session(...args));

  it("finds the setup session by its work key", () => {
    expect(isSecureFoundationSetup({ workKey: SECURE_FOUNDATION_WORK_KEY })).toBe(true);
    expect(isSecureFoundationSetup({ workKey: "issue:1" })).toBe(false);
  });

  it("follows the progress the session reports", () => {
    expect(phase("starting")).toEqual({ phase: "preparing", url: null });
    expect(phase("running", "checking this computer")).toEqual({ phase: "preparing", url: null });
    expect(phase("running", "installing")).toEqual({ phase: "installing", url: null });
    expect(phase("idle", "running at http://localhost:3001")).toEqual({
      phase: "running",
      url: "http://localhost:3001",
    });
  });

  it("says waiting whenever the session waits on the person", () => {
    expect(phase("waiting", "installing").phase).toBe("waiting");
    expect(phase("waiting", "running at http://localhost:3000").phase).toBe("waiting");
    expect(phase("idle").phase).toBe("waiting");
  });

  it("says stopped once the session's processes are gone, whatever it reported last", () => {
    for (const status of ["completed", "stopped", "interrupted"] as const) {
      expect(phase(status, "running at http://localhost:3000")).toEqual({
        phase: "stopped",
        url: null,
      });
    }
    expect(
      phase("idle", "running at http://localhost:3000", { archivedAt: "2026-01-06T10:00:00.000Z" })
        .phase,
    ).toBe("stopped");
    expect(phase("idle", "stopped").phase).toBe("stopped");
  });

  it("says failed for a failed session, a failed start and a reported failure", () => {
    expect(phase("failed", "installing").phase).toBe("failed");
    expect(phase("idle", "failed: Convex sign-in timed out").phase).toBe("failed");
    expect(
      phase("starting", null, { startError: { code: "open_failed", message: "x" } as never }).phase,
    ).toBe("failed");
  });

  it("links only to a URL on this computer", () => {
    expect(phase("idle", "running at http://127.0.0.1:3000/").url).toBe("http://127.0.0.1:3000/");
    expect(phase("idle", "running at https://example.org").url).toBeNull();
    expect(phase("idle", "running at http://localhost.example.org:3000")).toEqual({
      phase: "running",
      url: null,
    });
    expect(phase("idle", "running at javascript:alert(1)").url).toBeNull();
  });

  it("ignores progress that isn't the setup's own", () => {
    const other = {
      ...session("running"),
      progress: { text: "running at http://localhost:1", at: "2026-01-05T10:00:00.000Z" },
    } as Session;
    expect(secureFoundationStatus(other).phase).toBe("preparing");
  });
});

describe("the Connections step's shapes", () => {
  it("round-trip, and name only the services the answers need", async () => {
    const c = await import("../src/index");
    expect(c.secureFoundationServices({ secrets: "env_local" })).toEqual(["convex"]);
    expect(c.secureFoundationServices({ secrets: "doppler" })).toEqual(["convex", "doppler"]);
    const connection = {
      service: "convex",
      cli: "ready",
      signedIn: true,
      message: "Signed in to Convex.",
      install: null,
      teams: [{ name: "Acme Labs", slug: "acme-labs" }],
      account: null,
      owners: [],
      lastOwner: null,
      missingScopes: [],
      scopes: [],
    };
    expect(roundTrip(c.SecureFoundationConnections, { connections: [connection] })).toEqual({
      connections: [connection],
    });
    // GitHub's owners, with the one chosen for the last deploy; an older answer without it reads null.
    const github = {
      ...connection,
      service: "github",
      teams: [],
      account: "octo",
      owners: ["octo", "acme-org"],
      lastOwner: "acme-org",
    };
    expect(roundTrip(c.SecureFoundationConnection, github)).toEqual(github);
    const { lastOwner: _, ...older } = github;
    expect(c.SecureFoundationConnection.parse(older).lastOwner).toBeNull();
    for (const status of ["starting", "waiting", "done", "failed", "cancelled", "timed_out"]) {
      const login = { id: "l1", service: "doppler", status, url: null, code: null, message: "" };
      expect(roundTrip(c.SecureFoundationLogin, login)).toEqual(login);
      expect(c.isLoginRunning(login as never)).toBe(status === "starting" || status === "waiting");
    }
    expect(c.SecureFoundationConnectionsQuery.parse({ services: "convex,doppler" })).toEqual({
      services: ["convex", "doppler"],
    });
    expect(c.SecureFoundationConnectionsQuery.safeParse({ services: "convex,ssh" }).success).toBe(
      false,
    );
    // The npx package is pinned to a version, never "latest".
    expect(c.SECURE_FOUNDATION_NPX_PACKAGES.convex).toMatch(/^convex@\d+\.\d+\.\d+$/);
  });

  it("carries the chosen Convex team in the request and names it in what is created", () => {
    const request = CreateSecureFoundationRequest.parse({
      name: "My Site",
      adminEmail: "person@site.test",
      provider: "fake",
      commit: COMMIT,
      convexTeam: "acme-labs",
    });
    expect(request.convexTeam).toBe("acme-labs");
    expect(secureFoundationCreates(request)[1]?.item).toContain('your Convex team "acme-labs"');
    for (const bad of ["a b", '"; rm', "../x", ""]) {
      expect(
        CreateSecureFoundationRequest.safeParse({ ...request, convexTeam: bad }).success,
        bad,
      ).toBe(false);
    }
  });
});

describe("the deploy option", () => {
  const deploy = { owner: "acme-org", repository: "my-site", vercelScope: "acme-team" };

  it("is off unless a fork flips its one constant", async () => {
    const c = await import("../src/index");
    expect(c.SECURE_FOUNDATION_DEFAULT_DEPLOY).toBe(false);
    expect(c.secureFoundationServices({ secrets: "env_local", deploy: true })).toEqual([
      "convex",
      "github",
      "vercel",
    ]);
    expect(c.secureFoundationServices({ secrets: "doppler", deploy: false })).toEqual([
      "convex",
      "doppler",
    ]);
    expect(c.SECURE_FOUNDATION_NPX_PACKAGES.vercel).toMatch(/^vercel@\d+\.\d+\.\d+$/);
  });

  it("travels in the request, private only", () => {
    const base = {
      name: "My Site",
      adminEmail: "person@site.test",
      provider: "fake",
      commit: COMMIT,
    };
    const request = roundTrip(CreateSecureFoundationRequest, { ...base, deploy });
    expect(request.deploy).toEqual({ ...deploy, visibility: "private" });
    expect(roundTrip(CreateSecureFoundationRequest, base).deploy).toBeUndefined();
    for (const bad of [
      { ...deploy, visibility: "public" },
      { ...deploy, repository: "x.git" },
      { ...deploy, repository: ".github" },
      { ...deploy, owner: "-x" },
    ]) {
      expect(CreateSecureFoundationRequest.safeParse({ ...base, deploy: bad }).success).toBe(false);
    }
  });

  it("lists the repository, the Vercel project and what is pushed to them", () => {
    const local = secureFoundationCreates({ name: "My Site", secrets: "env_local", deploy });
    expect(local.map((c) => c.service)).toEqual(["Clerk", "Convex", "GitHub", "Vercel"]);
    expect(local[2]?.item).toContain("a private repository acme-org/my-site");
    expect(local[2]?.item).not.toContain("DOPPLER_TOKEN");
    expect(local[3]?.item).toContain('named "my-site" in the scope "acme-team"');
    expect(local[3]?.item).toContain("public vercel.app address");
    const doppler = secureFoundationCreates({ name: "My Site", secrets: "doppler", deploy });
    expect(doppler[3]?.item).toContain("Actions secret DOPPLER_TOKEN");
    expect(doppler[4]?.item).toContain(
      "a Doppler token as DOPPLER_TOKEN on its development, preview and production environments, the only environment variable the setup adds",
    );
    // The template's steps create two Doppler service tokens with the deploy, and none without it.
    expect(doppler[2]?.item).toContain("github-actions-ci (stored in GitHub as DOPPLER_TOKEN)");
    expect(doppler[2]?.item).toContain("vercel-runtime-dev (stored in Vercel)");
    const dopplerLocal = secureFoundationCreates({ name: "My Site", secrets: "doppler" });
    expect(dopplerLocal[2]?.item).not.toContain("service tokens");
  });
});

describe("what Go checks first", () => {
  it("takes the form as it stands, right or wrong, but nothing unbounded", () => {
    const wrong = { name: "../x", adminEmail: "nobody", provider: "", deploy: {} };
    expect(roundTrip(VerifySecureFoundationRequest, wrong)).toEqual({ ...wrong, modules: [] });
    expect(
      VerifySecureFoundationRequest.safeParse({ ...wrong, name: "x".repeat(201) }).success,
    ).toBe(false);
    // No field names a URL or a path the server would read.
    const parsed = VerifySecureFoundationRequest.parse({ ...wrong, url: "https://example.org/x" });
    expect(parsed).not.toHaveProperty("url");
  });

  it("answers every check with what to do about it, and the commit resolved", () => {
    const response = {
      checks: [
        { id: "fields", status: "passed", message: "The form's answers are valid.", fix: null },
        {
          id: "folder",
          status: "failed",
          message: "/projects/my-site already exists.",
          fix: "Choose another project name.",
        },
      ],
      template: null,
    };
    expect(roundTrip(VerifySecureFoundationResponse, response)).toEqual(response);
    expect(
      VerifySecureFoundationResponse.safeParse({
        checks: [{ id: "signins", status: "passed", message: "", fix: null }],
        template: null,
      }).success,
    ).toBe(false);
  });
});

describe("the one line that names what is created", () => {
  const deploy = { owner: "acme-org", repository: "my-site", vercelScope: "acme-team" };

  it("is made from the list the setup session is held to", () => {
    expect(
      secureFoundationCreatesLine(secureFoundationCreates({ name: "My Site", secrets: "doppler" })),
    ).toBe("Creates a Clerk app, a Convex project and a Doppler project in your accounts.");
    expect(
      secureFoundationCreatesLine(
        secureFoundationCreates({ name: "My Site", secrets: "env_local" }),
      ),
    ).toBe("Creates a Clerk app and a Convex project in your accounts.");
    const all = secureFoundationCreates({ name: "My Site", secrets: "doppler", deploy });
    expect(secureFoundationCreatesLine(all)).toBe(
      "Creates a Clerk app, a Convex project, a Doppler project, a private GitHub repository and a Vercel project with a public site in your accounts.",
    );
    // One short name per thing created: none is left out of the line.
    for (const created of all) expect(secureFoundationCreatesLine(all)).toContain(created.short);
  });
});

describe("a new project is quiet", () => {
  const setup = { workKey: SECURE_FOUNDATION_WORK_KEY };
  const other = { workKey: "issue:1" };

  it("starts in Manual mode, and Assisted is the mode that turns automatic work on", () => {
    expect(SECURE_FOUNDATION_PROJECT_MODE).toBe("manual");
    expect(SECURE_FOUNDATION_OPT_IN_MODE).toBe("assisted");
  });

  it("while it has a setup session and is still in the mode it was created in", () => {
    expect(isSecureFoundationQuiet({ autonomyMode: "manual" }, [other, setup])).toBe(true);
    // The person turned automatic work on (any other mode), and off again.
    for (const mode of ["assisted", "software_factory", "dark_factory"] as const) {
      expect(isSecureFoundationQuiet({ autonomyMode: mode }, [setup])).toBe(false);
    }
  });

  it("is answered by the server as one flag", () => {
    expect(SecureFoundationQuiet.parse({ quiet: true })).toEqual({ quiet: true });
    expect(SecureFoundationQuiet.safeParse({}).success).toBe(false);
  });

  it("never applies to a project Secure Foundation didn't set up", () => {
    expect(isSecureFoundationQuiet({ autonomyMode: "manual" }, [other])).toBe(false);
    expect(isSecureFoundationQuiet({ autonomyMode: "manual" }, [])).toBe(false);
  });
});
