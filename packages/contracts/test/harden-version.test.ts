import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatHardenVersion,
  HARDEN_VERSION,
  HARDEN_VERSION_PATTERN,
  HealthResponse,
  SOURCE_VERSION,
  UPSTREAM_VERSION,
} from "../src/index";

type Globals = { __CODEDEN_PACKAGE_VERSION__?: string; __CODEHARDEN_VERSION__?: string };
const globals = globalThis as Globals;

afterEach(() => {
  delete globals.__CODEDEN_PACKAGE_VERSION__;
  delete globals.__CODEHARDEN_VERSION__;
  vi.resetModules();
});

describe("the CodeHarden version line", () => {
  it("reads the checkout's VERSION when nothing is injected (workspace, tests, pnpm dev)", () => {
    expect(HARDEN_VERSION).toMatch(HARDEN_VERSION_PATTERN);
    expect(UPSTREAM_VERSION).toBe(SOURCE_VERSION);
  });

  it("formats both versions on one line", () => {
    expect(formatHardenVersion({ hardenVersion: "2026.1122.2006", upstreamVersion: "0.7.7" })).toBe(
      "CodeHarden 2026.1122.2006 · CodeDen 0.7.7 (upstream)",
    );
    expect(formatHardenVersion()).toBe(
      `CodeHarden ${HARDEN_VERSION} · CodeDen ${SOURCE_VERSION} (upstream)`,
    );
    // A server that reports only one of them: the other is this build's.
    expect(formatHardenVersion({ hardenVersion: "2026.0105.0518" })).toBe(
      `CodeHarden 2026.0105.0518 · CodeDen ${SOURCE_VERSION} (upstream)`,
    );
  });

  it("keeps the injected version's zeros and ignores the package version (a published build)", async () => {
    // What the published entry records from its package.json: the npm form, zeros stripped.
    globals.__CODEDEN_PACKAGE_VERSION__ = "2026.105.518";
    // What the bundler's define puts in place of the constant.
    globals.__CODEHARDEN_VERSION__ = "2026.0105.0518";
    vi.resetModules();
    const built = await import("../src/index");
    expect(built.CODEDEN_VERSION).toBe("2026.105.518");
    expect(built.HARDEN_VERSION).toBe("2026.0105.0518");
    expect(built.UPSTREAM_VERSION).toBe(SOURCE_VERSION);
    expect(built.formatHardenVersion()).toBe(
      `CodeHarden 2026.0105.0518 · CodeDen ${SOURCE_VERSION} (upstream)`,
    );
  });

  it("falls back to the checkout when the injected value is not a CodeHarden version", async () => {
    globals.__CODEHARDEN_VERSION__ = "2026.105.518";
    vi.resetModules();
    const built = await import("../src/index");
    expect(built.HARDEN_VERSION).toBe(HARDEN_VERSION);
  });

  it("round-trips the version API's fields, and still reads a server without them", () => {
    const health = {
      ok: true as const,
      name: "codeden" as const,
      version: "2026.105.518",
      hardenVersion: "2026.0105.0518",
      upstreamVersion: "0.7.7",
      uptimeSec: 1,
    };
    expect(HealthResponse.parse(JSON.parse(JSON.stringify(health)))).toEqual(health);
    const { hardenVersion: _harden, upstreamVersion: _upstream, ...older } = health;
    expect(HealthResponse.parse(older)).toEqual(older);
  });
});
