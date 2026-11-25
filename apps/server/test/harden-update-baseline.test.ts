/**
 * What "an update is available" compares with. A source build's package version is upstream's
 * (`0.7.7`), so compared with that every CodeHarden release on npm looked newer, including one
 * older than the checkout. A source build now compares with the CodeHarden version it was made
 * from; a published build and the desktop app compare exactly as before.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HARDEN_PRODUCT_NAME,
  HARDEN_VERSION,
  HARDEN_VERSION_PATTERN,
  HARDEN_VERSION_UNKNOWN,
  hardenNpmVersion,
  type InstallSource,
  isNewerVersion,
} from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { hardenUpdateBaseline } from "../src/services/updates/harden-baseline";
import { writeUpdateResult } from "../src/services/updates/last-result";
import { type SelfUpdateHost, UpdateService } from "../src/services/updates/service";

/** The package version in the repository: upstream's, never bumped here. */
const UPSTREAM = "0.7.7";
/** The checkout the owner ran, and what npm had: one release older, then one newer. */
const CHECKOUT = "2026.1123.0917";
const OLDER_ON_NPM = "2026.1122.2302";
const NEWER_ON_NPM = "2026.1124.900";

const offers = (source: InstallSource, current: string, latest: string, harden = CHECKOUT) =>
  isNewerVersion(latest, hardenUpdateBaseline(source, current, latest, harden));

describe("what a source build compares the registry's version with", () => {
  it("shows no update when npm has an older release than the checkout", () => {
    expect(hardenUpdateBaseline("source", UPSTREAM, OLDER_ON_NPM, CHECKOUT)).toBe("2026.1123.917");
    expect(offers("source", UPSTREAM, OLDER_ON_NPM)).toBe(false);
    // The checkout's own release, once it is published.
    expect(offers("source", UPSTREAM, "2026.1123.917")).toBe(false);
  });

  it("shows one when npm has a newer release", () => {
    expect(offers("source", UPSTREAM, NEWER_ON_NPM)).toBe(true);
    // Fields compare as numbers, not as text: 09:00 the next day beats 23:02.
    expect(offers("source", UPSTREAM, "2026.1123.918")).toBe(true);
    expect(offers("source", UPSTREAM, "2027.101.0")).toBe(true);
  });

  it("leaves a published build and the desktop app comparing with their own version", () => {
    for (const source of ["packaged", "desktop"] as const) {
      // Whatever the build-time CodeHarden version says, the package version decides.
      expect(hardenUpdateBaseline(source, "2026.1122.2006", NEWER_ON_NPM, CHECKOUT)).toBe(
        "2026.1122.2006",
      );
      expect(offers(source, "2026.1122.2006", OLDER_ON_NPM)).toBe(true);
      expect(offers(source, "2026.1122.2302", OLDER_ON_NPM)).toBe(false);
      expect(offers(source, "2026.1125.0", NEWER_ON_NPM)).toBe(false);
    }
  });

  it("falls back to the package version when the CodeHarden version is unknown", () => {
    for (const unknown of [HARDEN_VERSION_UNKNOWN, "", "0.7.7", "2026.1123"]) {
      expect(hardenUpdateBaseline("source", UPSTREAM, OLDER_ON_NPM, unknown)).toBe(UPSTREAM);
      // Today's behaviour: an update is offered rather than hidden.
      expect(offers("source", UPSTREAM, OLDER_ON_NPM, unknown)).toBe(true);
    }
  });

  it("falls back when the registry's version is not a CodeHarden version", () => {
    expect(hardenUpdateBaseline("source", "0.1.0", "0.2.0", CHECKOUT)).toBe("0.1.0");
    expect(offers("source", "0.1.0", "0.2.0")).toBe(true);
    expect(offers("source", "0.2.0", "0.2.0")).toBe(false);
    expect(hardenUpdateBaseline("source", UPSTREAM, "2026.1124.900-beta.1", CHECKOUT)).toBe(
      UPSTREAM,
    );
  });
});

describe("the update service of a source build", () => {
  const home = () => mkdtempSync(join(tmpdir(), "codeharden-baseline-"));
  const registryWith = (latest: string) =>
    (async () =>
      new Response(JSON.stringify({ latest }), { status: 200 })) as typeof globalThis.fetch;
  const service = (latest: string, host?: SelfUpdateHost, current = UPSTREAM) =>
    new UpdateService({
      home: home(),
      mode: () => "notify",
      registry: "http://registry.test",
      fetch: registryWith(latest),
      current,
      host,
    });
  // This checkout's own version (the root VERSION file), so the test holds after every release.
  const own = hardenNpmVersion(HARDEN_VERSION);
  const [year = "", monthDay = "", time = ""] = own.split(".");

  it("knows the CodeHarden version it was made from", () => {
    expect(HARDEN_VERSION).toMatch(HARDEN_VERSION_PATTERN);
  });

  it("is quiet about its own release and about older ones", async () => {
    expect(await service(own).status()).toMatchObject({
      current: UPSTREAM,
      latest: own,
      source: "source",
      updateAvailable: false,
    });
    const older = `${Number(year) - 1}.${monthDay}.${time}`;
    expect((await service(older).status()).updateAvailable).toBe(false);
  });

  it("offers a release newer than the checkout, by name", async () => {
    const newer = `${Number(year) + 1}.${monthDay}.${time}`;
    // The status still names the version npm has; the banner tells to pull and rebuild.
    expect(await service(newer).status()).toMatchObject({
      latest: newer,
      source: "source",
      updateAvailable: true,
    });
  });

  it("a published build with the same numbers is offered what is newer than its package", async () => {
    const packaged: SelfUpdateHost = {
      source: "packaged",
      restartCommand: "codeharden",
      launcherVersion: "2026.101.0",
    };
    expect((await service(own, packaged, "2026.101.0").status()).updateAvailable).toBe(true);
    expect((await service(own, packaged, own).status()).updateAvailable).toBe(false);
  });
});

describe("the update service's messages name the product", () => {
  it("says which product can't update itself from source, and which version did not start", () => {
    expect(HARDEN_PRODUCT_NAME).toBe("CodeHarden");
    const dir = mkdtempSync(join(tmpdir(), "codeharden-baseline-"));
    const deps = { home: dir, mode: () => "notify" as const, registry: "http://registry.test" };
    expect(() => new UpdateService(deps).install()).toThrow(
      "You're running CodeHarden from source: pull and rebuild to update.",
    );
    writeUpdateResult(dir, { from: "2026.1122.2006", to: "2026.1123.917", ok: false });
    expect(new UpdateService(deps).snapshot().installError).toBe(
      "CodeHarden 2026.1123.917 did not start",
    );
  });
});
