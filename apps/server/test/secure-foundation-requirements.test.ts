import {
  type SecureFoundationConnection,
  SecureFoundationRequirements,
  type SecureFoundationService,
} from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import type { Command } from "../src/services/secure-foundation/connections/commands";
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
