import {
  type SecureFoundationConnection,
  SecureFoundationRequirements,
  type SecureFoundationService,
} from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import {
  type Command,
  clerkStatus,
  SERVICE_COMMANDS,
} from "../src/services/secure-foundation/connections/commands";
import type { CliResult } from "../src/services/secure-foundation/connections/process";
import { checkRequirements } from "../src/services/secure-foundation/requirements";

/** The requirements check over scripted answers: no CLI runs and nothing is asked of a service. */

const ran = (output: string, code = 0): CliResult => ({
  code,
  output,
  notFound: false,
  timedOut: false,
});
const NOT_FOUND: CliResult = { code: null, output: "", notFound: true, timedOut: false };
const TIMED_OUT: CliResult = { code: null, output: "", notFound: false, timedOut: true };

const VERSIONS: Record<string, CliResult> = {
  node: ran("v22.11.0\n"),
  npm: ran("10.9.0\n"),
  git: ran("git version 2.47.0\n"),
  doppler: ran("v3.75.1\n"),
  gh: ran("gh version 2.62.0 (2026-01-01)\nhttps://github.com/cli/cli/releases/tag/v2.62.0\n"),
};

const connection = (
  service: SecureFoundationService,
  patch: Partial<SecureFoundationConnection> = {},
): SecureFoundationConnection => ({
  service,
  cli: "ready",
  signedIn: true,
  message: "",
  install: null,
  teams: [{ name: "Acme Labs", slug: "acme-labs" }],
  account: "demo-person",
  owners: ["demo-person", "acme-org"],
  lastOwner: null,
  missingScopes: [],
  scopes: [],
  ...patch,
});

async function check(
  versions: Record<string, CliResult> = {},
  connections: Partial<Record<SecureFoundationService, Partial<SecureFoundationConnection>>> = {},
) {
  const asked: Command[] = [];
  const result = await checkRequirements({
    runAll: async (commands) => {
      asked.push(...commands);
      return commands.map((c) => ({ ...VERSIONS, ...versions })[c.program] ?? NOT_FOUND);
    },
    states: async (services) => services.map((s) => connection(s, connections[s])),
    platform: "linux",
    now: () => new Date("2026-01-05T10:00:00.000Z"),
  });
  const of = (id: string) => result.tools.find((t) => t.id === id);
  return { result, asked, of };
}

describe("Clerk's sign-in, read from `clerk whoami --json`", () => {
  const EMAIL = "alice@example.com";
  const signedIn = ran(
    `${JSON.stringify({ email: EMAIL, localSecretKeySource: null, linked: null }, null, 2)}\n`,
  );

  it("is yes when the answer names an account, and the email goes no further", () => {
    const reading = clerkStatus(signedIn);
    expect(reading).toEqual({ signedIn: true, teams: [] });
    expect(JSON.stringify(reading)).not.toContain("alice");
  });

  it("is no for the tool's own not-logged-in and session-expired answers", () => {
    for (const output of [
      "Not logged in. Run `clerk auth login` to authenticate\n",
      "Session expired. Run `clerk auth login` to re-authenticate\n",
      // What clerk 4.4.0 really prints without a session, run as the app runs it (no terminal):
      // exit 1, nothing on stdout, this one line on stderr.
      '{"error":{"code":"auth_required","message":"Not logged in. Run `clerk auth login` to authenticate"}}\n',
    ]) {
      expect(clerkStatus(ran(output, 1))).toEqual({ signedIn: false, teams: [] });
    }
  });

  it("is unknown, never signed out, for anything else", () => {
    for (const result of [
      TIMED_OUT,
      ran("Request failed (500)\n", 1),
      ran("keychain: access denied\n", 1),
      ran("error: unknown option '--json'\n", 2),
      ran("not json at all\n"),
      // An unclaimed app's key in the folder: no account to name.
      ran(JSON.stringify({ email: null, accountless: { instanceId: "ins_1" }, linked: null })),
      ran(JSON.stringify({ email: "" })),
    ]) {
      expect(clerkStatus(result).signedIn).toBeNull();
    }
  });

  it("uses fixed commands on the pinned package, and reads the sign-in page it prints", () => {
    const { status, login, readLogin } = SERVICE_COMMANDS.clerk;
    expect([status.program, ...status.args]).toEqual([
      "npx",
      "--yes",
      "clerk@4.4.0",
      "whoami",
      "--json",
    ]);
    expect([login.program, ...login.args]).toEqual([
      "npx",
      "--yes",
      "clerk@4.4.0",
      "auth",
      "login",
    ]);
    const url =
      "https://clerk.clerk.com/oauth/authorize?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A5123%2Fcallback&state=xyz";
    expect(
      readLogin(`Opening your browser to sign in. If it doesn't open, use this URL:\n  ${url}\n`),
    ).toEqual({ url, code: null });
    // A link to another host is not a sign-in page.
    expect(readLogin("See https://example.com/clerk.com for help").url).toBeNull();
  });

  it("reaches the page as signed in or not, without the account", async () => {
    const { result, of } = await check({}, { clerk: { signedIn: false, account: EMAIL } });
    expect(of("clerk")).toMatchObject({ state: "needs_sign_in", signedIn: false });
    expect(JSON.stringify(result)).not.toContain("alice");
  });
});

describe("the requirements check", () => {
  it("asks each tool for its version only, and reads everything there as ok", async () => {
    const { result, asked, of } = await check();
    expect(asked.map((c) => `${c.program} ${c.args.join(" ")}`)).toEqual([
      "node --version",
      "npm --version",
      "git --version",
      "doppler --version",
      "gh --version",
    ]);
    expect(result.tools.map((t) => [t.id, t.state, t.version])).toEqual([
      ["node", "ok", "22.11.0"],
      ["npm", "ok", "10.9.0"],
      ["git", "ok", "2.47.0"],
      // Run through npx: the version is the pinned one.
      ["convex", "ok", "1.43.0"],
      ["doppler", "ok", "3.75.1"],
      ["gh", "ok", "2.62.0"],
      ["vercel", "ok", "66.6.0"],
      ["clerk", "ok", "4.4.0"],
    ]);
    expect(of("node")?.signedIn).toBeNull();
    expect(of("convex")?.signedIn).toBe(true);
    expect(result.platform).toBe("linux");
    expect(SecureFoundationRequirements.parse(result)).toEqual(result);
  });

  it("answers nothing personal: no account, team, owner or command output", async () => {
    const { result } = await check({
      doppler: ran("v3.75.1\ntoken: dp.st.made-up-secret-value\n"),
    });
    const text = JSON.stringify(result);
    for (const personal of ["demo-person", "acme", "Acme", "made-up-secret", "github.com"]) {
      expect(text).not.toContain(personal);
    }
  });

  it("says missing for a tool that isn't found, and too old for an old Node.js", async () => {
    const { of } = await check({ git: NOT_FOUND, node: ran("v16.20.2\n") });
    expect(of("git")).toMatchObject({ state: "missing", found: false, version: null });
    expect(of("node")).toMatchObject({ state: "outdated", found: true, version: "16.20.2" });
  });

  it("says unknown, not missing, when a tool timed out or failed", async () => {
    const { of } = await check({ git: TIMED_OUT, npm: ran("boom", 1) });
    expect(of("git")).toMatchObject({ state: "unknown", found: null });
    expect(of("git")?.message).toContain("took too long");
    expect(of("npm")).toMatchObject({ state: "unknown", found: null, version: null });
  });

  it("reads each service's sign-in from the sign-in checks", async () => {
    const { of } = await check(
      {},
      {
        convex: { signedIn: false },
        doppler: { signedIn: null },
        github: { missingScopes: ["workflow"] },
        vercel: { cli: "missing", signedIn: null },
      },
    );
    expect(of("convex")).toMatchObject({ state: "needs_sign_in", found: true, signedIn: false });
    expect(of("doppler")).toMatchObject({ state: "unknown", found: true, signedIn: null });
    expect(of("gh")).toMatchObject({ state: "needs_permission", signedIn: true });
    expect(of("gh")?.message).toContain("workflow");
    // npx itself wasn't found: it is Node.js that is missing.
    expect(of("vercel")).toMatchObject({ state: "missing", found: false, version: null });
    expect(of("vercel")?.message).toContain("Node.js");
  });

  it("says missing for a service's tool that isn't installed, whatever else was answered", async () => {
    const { of } = await check({ doppler: NOT_FOUND }, { doppler: { cli: "missing" } });
    expect(of("doppler")).toMatchObject({ state: "missing", found: false, signedIn: null });
  });

  it("reads as unknown when a check throws, instead of failing the page", async () => {
    const result = await checkRequirements({
      runAll: async () => {
        throw new Error("no shell");
      },
      states: async () => {
        throw new Error("no shell");
      },
    });
    expect(result.tools.every((t) => t.state === "unknown")).toBe(true);
  });
});
