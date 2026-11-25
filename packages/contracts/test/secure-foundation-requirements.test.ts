import { describe, expect, it } from "vitest";
import {
  SECURE_FOUNDATION_ACCOUNTS,
  SECURE_FOUNDATION_TOOLS,
  SecureFoundationRequirements,
  type SecureFoundationToolCheck,
  secureFoundationInstallHint,
  secureFoundationRequirementsSummary,
  secureFoundationServices,
  secureFoundationTool,
} from "../src/index";

const roundTrip = <T>(schema: { parse: (v: unknown) => T }, value: unknown): T =>
  schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));

const ok = (id: SecureFoundationToolCheck["id"]): SecureFoundationToolCheck => ({
  id,
  state: "ok",
  found: true,
  version: "1.2.3",
  signedIn: null,
  message: "Installed.",
});
const allOk = () => SECURE_FOUNDATION_TOOLS.map((t) => ok(t.id));
const withTool = (id: SecureFoundationToolCheck["id"], state: SecureFoundationToolCheck["state"]) =>
  allOk().map((t) => (t.id === id ? { ...t, state } : t));

describe("the requirements list", () => {
  it("is where Go's sign-in checks get their services, in the order they are shown", () => {
    expect(secureFoundationServices({ secrets: "env_local" })).toEqual(["convex"]);
    expect(secureFoundationServices({ secrets: "doppler", deploy: true })).toEqual([
      "convex",
      "doppler",
      "github",
      "vercel",
    ]);
  });

  it("links only to https pages, and every account's tool holds a service's sign-in", () => {
    for (const tool of SECURE_FOUNDATION_TOOLS) expect(tool.installUrl).toMatch(/^https:\/\//);
    for (const account of SECURE_FOUNDATION_ACCOUNTS) {
      expect(account.url).toMatch(/^https:\/\//);
      expect(secureFoundationTool(account.tool).service).toBeTruthy();
      expect(secureFoundationTool(account.tool).neededFor).toBe(account.neededFor);
    }
  });

  it("keeps Clerk out of everything a setup checks: it is for after the install", () => {
    expect(secureFoundationTool("clerk")).toMatchObject({ neededFor: "later", service: "clerk" });
    // Never one of the sign-ins Go asks, whatever the answers.
    for (const secrets of ["doppler", "env_local"] as const) {
      for (const deploy of [true, false]) {
        expect(secureFoundationServices({ secrets, deploy })).not.toContain("clerk");
      }
    }
    // Signed out, missing or unknown, it never brings the page up or blocks.
    for (const state of ["needs_sign_in", "missing", "unknown"] as const) {
      expect(secureFoundationRequirementsSummary({ tools: withTool("clerk", state) })).toEqual({
        attention: false,
        blocking: false,
      });
    }
  });

  it("gives one install line per system, or points at the install page", () => {
    expect(secureFoundationInstallHint("gh", "darwin")).toBe("brew install gh");
    expect(secureFoundationInstallHint("doppler", "win32")).toBe("winget install doppler.doppler");
    expect(secureFoundationInstallHint("doppler", "freebsd")).toBe(
      "See https://docs.doppler.com/docs/install-cli",
    );
  });
});

describe("the requirements check's shape", () => {
  it("round-trips, and takes a version number only", () => {
    const value = { checkedAt: "2026-01-05T10:00:00.000Z", platform: "darwin", tools: allOk() };
    expect(roundTrip(SecureFoundationRequirements, value)).toEqual(value);
    const leaky = { ...value, tools: [{ ...ok("gh"), version: "token: abc def" }] };
    expect(SecureFoundationRequirements.safeParse(leaky).success).toBe(false);
  });
});

describe("what the checks come to", () => {
  it("is nothing when every tool is there", () => {
    expect(secureFoundationRequirementsSummary({ tools: allOk() })).toEqual({
      attention: false,
      blocking: false,
    });
  });

  it("blocks on what every setup needs: a missing tool, an old Node.js, Convex signed out", () => {
    for (const [id, state] of [
      ["git", "missing"],
      ["node", "outdated"],
      ["convex", "needs_sign_in"],
    ] as const) {
      expect(secureFoundationRequirementsSummary({ tools: withTool(id, state) })).toEqual({
        attention: true,
        blocking: true,
      });
    }
  });

  it("shows, without blocking, what couldn't be checked", () => {
    expect(secureFoundationRequirementsSummary({ tools: withTool("convex", "unknown") })).toEqual({
      attention: true,
      blocking: false,
    });
  });

  it("is never raised by a tool only an option needs", () => {
    for (const id of ["doppler", "gh", "vercel"] as const) {
      expect(secureFoundationRequirementsSummary({ tools: withTool(id, "missing") })).toEqual({
        attention: false,
        blocking: false,
      });
    }
  });
});
