/**
 * The install's identity: what keeps this product and upstream CodeDen (or another fork) apart
 * on one machine. A build injects it; without one, CodeHarden's own values apply.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEEP_LINK_SCHEME,
  deepLinkUrl,
  formatHardenVersion,
  HARDEN_APP_ID,
  HARDEN_APP_SLUG,
  HARDEN_DEEP_LINK_SCHEME,
  HARDEN_DEFAULT_PORT,
  HARDEN_HOME_DIRNAME,
  HARDEN_HOME_DISPLAY,
  HARDEN_KEYCHAIN_SERVICE,
  HARDEN_PRODUCT_NAME,
  HARDEN_PROJECTS_DIRNAME,
  hardenHomeNotice,
  parseDeepLink,
  UPSTREAM_HOME_DIRNAME,
} from "../src/index";

type Globals = {
  __CODEHARDEN_PACKAGE__?: string;
  __CODEHARDEN_PRODUCT__?: unknown;
  __CODEHARDEN_APP_ID__?: unknown;
  __CODEHARDEN_SLUG__?: unknown;
  __CODEHARDEN_PORT__?: unknown;
};
const globals = globalThis as Globals;

afterEach(() => {
  delete globals.__CODEHARDEN_PACKAGE__;
  delete globals.__CODEHARDEN_PRODUCT__;
  delete globals.__CODEHARDEN_APP_ID__;
  delete globals.__CODEHARDEN_SLUG__;
  delete globals.__CODEHARDEN_PORT__;
  vi.resetModules();
});

describe("CodeHarden's identity", () => {
  it("is its own, and nothing in it is upstream's", () => {
    expect(HARDEN_PRODUCT_NAME).toBe("CodeHarden");
    expect(HARDEN_APP_ID).toBe("com.codeharden.app");
    expect(HARDEN_APP_SLUG).toBe("codeharden");
    expect(HARDEN_DEEP_LINK_SCHEME).toBe("codeharden");
    expect(DEEP_LINK_SCHEME).toBe("codeharden");
    expect(HARDEN_HOME_DIRNAME).toBe(".codeharden");
    expect(HARDEN_HOME_DISPLAY).toBe("~/.codeharden");
    expect(HARDEN_PROJECTS_DIRNAME).toBe("codeharden-projects");
    expect(HARDEN_KEYCHAIN_SERVICE).toBe("codeharden");
    expect(HARDEN_DEFAULT_PORT).toBe(4417);
    expect(HARDEN_HOME_DIRNAME).not.toBe(UPSTREAM_HOME_DIRNAME);
  });

  it("opens its own links and not upstream's", () => {
    expect(deepLinkUrl({ kind: "inbox" })).toBe("codeharden://inbox");
    expect(parseDeepLink("codeharden://inbox")).toEqual({ kind: "inbox" });
    expect(parseDeepLink("codeden://inbox")).toBeNull();
  });

  it("says in one line where the data lives now and how to keep the old home", () => {
    const notice = hardenHomeNotice();
    expect(notice).not.toContain("\n");
    expect(notice).toContain("~/.codeharden");
    expect(notice).toContain("codeharden --home ~/.codeden");
  });

  it("keeps the version line's format", () => {
    expect(formatHardenVersion({ hardenVersion: "2026.1122.2006", upstreamVersion: "0.7.7" })).toBe(
      "CodeHarden 2026.1122.2006 · CodeDen 0.7.7 (upstream)",
    );
  });

  it("takes the identity a build injects (a fork's own)", async () => {
    globals.__CODEHARDEN_PACKAGE__ = "example-harden";
    globals.__CODEHARDEN_PRODUCT__ = "Example Harden";
    globals.__CODEHARDEN_APP_ID__ = "org.example.harden";
    globals.__CODEHARDEN_SLUG__ = "exampleharden";
    globals.__CODEHARDEN_PORT__ = 4500;
    vi.resetModules();
    const built = await import("../src/index");
    expect(built.HARDEN_PRODUCT_NAME).toBe("Example Harden");
    expect(built.HARDEN_APP_ID).toBe("org.example.harden");
    expect(built.DEEP_LINK_SCHEME).toBe("exampleharden");
    expect(built.HARDEN_HOME_DIRNAME).toBe(".exampleharden");
    expect(built.HARDEN_PROJECTS_DIRNAME).toBe("exampleharden-projects");
    expect(built.HARDEN_KEYCHAIN_SERVICE).toBe("exampleharden");
    expect(built.HARDEN_DEFAULT_PORT).toBe(4500);
    expect(built.formatHardenVersion({ hardenVersion: "2026.0105.0518" })).toMatch(
      /^Example Harden 2026\.0105\.0518 · CodeDen /,
    );
    expect(built.hardenHomeNotice()).toContain("example-harden --home ~/.codeden");
  });

  it("falls back to CodeHarden's values when an injected one is malformed", async () => {
    globals.__CODEHARDEN_PRODUCT__ = "../Code Den";
    globals.__CODEHARDEN_APP_ID__ = "nodots";
    globals.__CODEHARDEN_SLUG__ = "../codeden";
    globals.__CODEHARDEN_PORT__ = "4317";
    vi.resetModules();
    const built = await import("../src/index");
    expect(built.HARDEN_PRODUCT_NAME).toBe("CodeHarden");
    expect(built.HARDEN_APP_ID).toBe("com.codeharden.app");
    expect(built.HARDEN_HOME_DIRNAME).toBe(".codeharden");
    expect(built.HARDEN_DEFAULT_PORT).toBe(4417);
  });
});
