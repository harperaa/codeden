import type { ProviderInfo } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import {
  afterLimit,
  LIMIT_RESET_MARGIN_MS,
  limitReset,
  pickFallback,
  type RoleFallback,
  roleName,
  switchText,
} from "../src/services/orchestration/role-fallback";

/**
 * The rules behind a role's move to another provider at a usage limit (§8.1). `role-limit-
 * switch.test.ts` covers the switch through the role sessions; this covers the rules themselves:
 * when a limit counts as reset, which providers are skipped and until when, and which provider
 * takes over. A mistake here moves a role onto a provider at its own limit, or onto one that
 * can't run read-only.
 */

const NOW = Date.parse("2026-03-10T10:00:00.000Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
/** A loaded provider; `capabilities` replaces the read-only default (one that doesn't say). */
const info = (id: string, capabilities: object = { readOnly: true }): ProviderInfo =>
  ({ id, displayName: id, models: [], capabilities }) as unknown as ProviderInfo;

describe("limitReset", () => {
  const fallback = (until: string | null): RoleFallback => ({ home: "claude", until, limited: {} });

  it("goes back only once the reset time and its margin have passed", () => {
    const state = fallback(at(0));
    expect(limitReset(state, NOW)).toBe(false);
    expect(limitReset(state, NOW + LIMIT_RESET_MARGIN_MS - 1)).toBe(false);
    expect(limitReset(state, NOW + LIMIT_RESET_MARGIN_MS)).toBe(true);
  });

  it("never goes back by itself without a reset time, or with one it can't read", () => {
    expect(limitReset(fallback(null), NOW + 365 * 86_400_000)).toBe(false);
    expect(limitReset(fallback("soon"), NOW + 365 * 86_400_000)).toBe(false);
  });
});

describe("afterLimit", () => {
  it("records the role's own provider as home, skipped until the reset time it gave", () => {
    expect(afterLimit(null, "claude", at(90), NOW)).toEqual({
      home: "claude",
      until: at(90),
      limited: { claude: at(90) },
    });
  });

  it("skips a provider that gave no reset time for an hour, and never goes back by itself", () => {
    expect(afterLimit(null, "claude", null, NOW)).toEqual({
      home: "claude",
      until: null,
      limited: { claude: at(60) },
    });
  });

  it("treats a reset time it can't read as none", () => {
    expect(afterLimit(null, "claude", "in a while", NOW)).toEqual({
      home: "claude",
      until: null,
      limited: { claude: at(60) },
    });
  });

  it("still skips the provider that just failed when its reset time has passed already", () => {
    const state = afterLimit(null, "claude", at(-30), NOW);
    expect(state.limited).toEqual({ claude: at(60) });
    // The stale time is kept as the home's reset: its next turn goes back and finds out.
    expect(state.until).toBe(at(-30));
    expect(limitReset(state, NOW)).toBe(true);
  });

  it("a second limit keeps the home and its reset time, and adds the fallback to the skipped", () => {
    const first = afterLimit(null, "claude", at(120), NOW);
    expect(afterLimit(first, "codex", at(45), NOW + 60_000)).toEqual({
      home: "claude",
      until: at(120),
      limited: { claude: at(120), codex: at(45) },
    });
  });

  it("drops skipped providers whose limit has passed", () => {
    const earlier: RoleFallback = {
      home: "claude",
      until: null,
      limited: { claude: at(-1), codex: at(0), opencode: at(30) },
    };
    expect(afterLimit(earlier, "gemini", null, NOW).limited).toEqual({
      opencode: at(30),
      gemini: at(60),
    });
  });

  it("a later limit of the same provider replaces its earlier time", () => {
    const earlier: RoleFallback = { home: "claude", until: at(10), limited: { codex: at(10) } };
    expect(afterLimit(earlier, "codex", at(200), NOW).limited).toEqual({ codex: at(200) });
  });
});

describe("pickFallback", () => {
  const all = [info("gemini"), info("codex"), info("claude"), info("custom")];
  const pick = (opts: Partial<Parameters<typeof pickFallback>[0]>) =>
    pickFallback({ preferred: [], providers: all, ready: null, limited: {}, now: NOW, ...opts });

  it("takes the preferred providers first, in their order, skipping Auto and unset ones", () => {
    expect(pick({ preferred: ["auto", null, undefined, "gemini", "codex"] })).toBe("gemini");
    expect(pick({ preferred: ["codex", "gemini"] })).toBe("codex");
  });

  it("then every loaded provider in the order Auto tries them, others last", () => {
    expect(pick({})).toBe("claude");
    expect(pick({ limited: { claude: at(5) } })).toBe("codex");
    expect(pick({ limited: { claude: at(5), codex: at(5), gemini: at(5) } })).toBe("custom");
  });

  it("skips a provider at its limit until that has passed", () => {
    expect(pick({ preferred: ["codex"], limited: { codex: at(1) } })).toBe("claude");
    expect(pick({ preferred: ["codex"], limited: { codex: at(0) } })).toBe("codex");
    expect(pick({ preferred: ["codex"], limited: { codex: at(-1) } })).toBe("codex");
  });

  it("never picks a provider the runner didn't load", () => {
    expect(pick({ preferred: ["cursor"], providers: [info("codex")] })).toBe("codex");
    expect(pick({ preferred: ["cursor"], providers: [] })).toBeNull();
  });

  it("never picks a provider that can't run read-only", () => {
    const providers = [info("claude", { readOnly: false }), info("codex", {}), info("gemini")];
    expect(pick({ preferred: ["claude", "codex"], providers })).toBe("gemini");
    expect(pick({ providers: [info("claude", { readOnly: false })] })).toBeNull();
  });

  it("only picks a ready provider when readiness is known", () => {
    expect(pick({ preferred: ["codex"], ready: new Set(["gemini"]) })).toBe("gemini");
    expect(pick({ ready: new Set() })).toBeNull();
    // Not known: every loaded provider counts.
    expect(pick({ preferred: ["codex"], ready: null })).toBe("codex");
  });

  it("is null when every provider is at a limit", () => {
    const limited = Object.fromEntries(all.map((p) => [p.id, at(30)]));
    expect(pick({ preferred: ["codex"], limited })).toBeNull();
  });
});

describe("the line about a switch", () => {
  const names = { from: "Claude", to: "Codex" };
  const base = { from: "claude", to: "codex" } as const;

  it("names the role", () => {
    expect(roleName("pm")).toBe("PM");
    expect(roleName("orchestrator")).toBe("Orchestrator");
  });

  it("says why the role moved, with the reset time in the given timezone", () => {
    expect(
      switchText(
        { ...base, reason: "usage_limit", retryAt: "2026-03-10T23:30:00.000Z" },
        names,
        "UTC",
      ),
    ).toBe("Switched from Claude to Codex: Claude hit its usage limit (until 2026-03-10 23:30).");
    expect(
      switchText(
        { ...base, reason: "usage_limit", retryAt: "2026-03-10T23:30:00.000Z" },
        names,
        "Asia/Tokyo",
      ),
    ).toBe("Switched from Claude to Codex: Claude hit its usage limit (until 2026-03-11 08:30).");
    expect(switchText({ ...base, reason: "usage_limit", retryAt: null }, names, "UTC")).toBe(
      "Switched from Claude to Codex: Claude hit its usage limit.",
    );
  });

  it("names the provider whose limit reset when the role goes back", () => {
    const data = { from: "codex", to: "claude", reason: "limit_reset", retryAt: null } as const;
    expect(switchText(data, { from: "Codex", to: "Claude", home: "Claude" }, "UTC")).toBe(
      "Switched back from Codex to Claude: Claude's usage limit has reset.",
    );
    expect(switchText(data, { from: "Codex", to: "Claude" }, "UTC")).toBe(
      "Switched back from Codex to Claude: Claude's usage limit has reset.",
    );
  });

  it("says that nothing was switched when no provider could take over", () => {
    const text = switchText(
      { from: "claude", to: null, reason: "no_fallback", retryAt: "2026-03-10T12:00:00.000Z" },
      { from: "Claude", to: "" },
      "UTC",
    );
    expect(text).toContain("Claude hit its usage limit (until 2026-03-10 12:00)");
    expect(text).toContain("nothing was switched");
  });
});
