import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  HARDEN_BRANCH,
  HARDEN_COMMAND,
  HARDEN_INSTALL_COMMAND,
  HARDEN_NPX_COMMAND,
  HARDEN_PACKAGE_NAME,
  HARDEN_PACKAGE_SEGMENTS,
  HARDEN_REPOSITORY,
  HARDEN_UPDATE_COMMAND,
  hardenChangelogUrl,
  hardenDocsUrl,
  hardenLatestReleaseUrl,
  hardenNpmVersion,
  hardenReleaseApiUrl,
  hardenReleaseTag,
  hardenReleaseUrl,
  hardenRepositoryUrl,
  hardenVersionOf,
  isNewerVersion,
} from "../src/index";

type Globals = {
  __CODEHARDEN_PACKAGE__?: string;
  __CODEHARDEN_REPOSITORY__?: string;
  __CODEHARDEN_BRANCH__?: string;
};
const globals = globalThis as Globals;

afterEach(() => {
  delete globals.__CODEHARDEN_PACKAGE__;
  delete globals.__CODEHARDEN_REPOSITORY__;
  delete globals.__CODEHARDEN_BRANCH__;
  vi.resetModules();
});

describe("CodeHarden's update channel", () => {
  it("defaults to CodeHarden's own package and repository", () => {
    expect(HARDEN_PACKAGE_NAME).toBe("codeharden");
    expect(HARDEN_REPOSITORY).toBe("harperaa/codeharden");
    expect(HARDEN_BRANCH).toBe("harden");
    expect(HARDEN_COMMAND).toBe("codeharden");
    expect(HARDEN_PACKAGE_SEGMENTS).toEqual(["codeharden"]);
  });

  it("names the channel's package in the commands people type", () => {
    expect(HARDEN_NPX_COMMAND).toBe("npx codeharden");
    expect(HARDEN_INSTALL_COMMAND).toBe("npm i -g codeharden@latest");
    expect(HARDEN_UPDATE_COMMAND).toBe("codeharden update");
  });

  it("maps a CodeHarden version to its npm form and back", () => {
    expect(hardenNpmVersion("2026.0105.0518")).toBe("2026.105.518");
    expect(hardenNpmVersion("2026.1122.2006")).toBe("2026.1122.2006");
    expect(hardenNpmVersion("2026.0101.0000")).toBe("2026.101.0");
    expect(hardenVersionOf("2026.105.518")).toBe("2026.0105.0518");
    expect(hardenVersionOf("2026.1123.905")).toBe("2026.1123.0905");
    expect(hardenVersionOf("2026.101.0")).toBe("2026.0101.0000");
    expect(hardenVersionOf("2026.1122.2006")).toBe("2026.1122.2006");
    for (const version of ["2026.0105.0518", "2026.1231.2359", "2027.0101.0000"]) {
      expect(hardenVersionOf(hardenNpmVersion(version))).toBe(version);
    }
  });

  it("leaves versions of another shape alone", () => {
    expect(hardenVersionOf("0.7.7")).toBe("0.7.7");
    expect(hardenVersionOf("99.0.0-test")).toBe("99.0.0-test");
    expect(hardenNpmVersion("0.7.7")).toBe("0.7.7");
    expect(hardenReleaseTag("0.7.7")).toBe("v0.7.7");
  });

  it("builds the release tag from the padded form, whichever form it is given", () => {
    expect(hardenReleaseTag("2026.105.518")).toBe("v2026.0105.0518");
    expect(hardenReleaseTag("2026.0105.0518")).toBe("v2026.0105.0518");
    expect(hardenReleaseTag("v2026.105.518")).toBe("v2026.0105.0518");
  });

  it("builds every link from the repository", () => {
    expect(hardenRepositoryUrl()).toBe("https://github.com/harperaa/codeharden");
    expect(hardenReleaseUrl("2026.105.518")).toBe(
      "https://github.com/harperaa/codeharden/releases/tag/v2026.0105.0518",
    );
    expect(hardenReleaseApiUrl("2026.1123.905")).toBe(
      "https://api.github.com/repos/harperaa/codeharden/releases/tags/v2026.1123.0905",
    );
    expect(hardenLatestReleaseUrl()).toBe("https://github.com/harperaa/codeharden/releases/latest");
    expect(hardenChangelogUrl()).toBe(
      "https://raw.githubusercontent.com/harperaa/codeharden/harden/CODEHARDEN-CHANGELOG.md",
    );
    expect(hardenDocsUrl("desktop.md")).toBe(
      "https://github.com/harperaa/codeharden/blob/harden/docs/desktop.md",
    );
    expect(hardenDocsUrl()).toBe("https://github.com/harperaa/codeharden/blob/harden/docs/");
  });

  it("takes the package and repository a build injects (a fork's own channel)", async () => {
    globals.__CODEHARDEN_PACKAGE__ = "@acme/harden";
    globals.__CODEHARDEN_REPOSITORY__ = "acme/harden-fork";
    globals.__CODEHARDEN_BRANCH__ = "acme/work";
    vi.resetModules();
    const built = await import("../src/index");
    expect(built.HARDEN_BRANCH).toBe("acme/work");
    expect(built.hardenChangelogUrl()).toBe(
      "https://raw.githubusercontent.com/acme/harden-fork/acme/work/CODEHARDEN-CHANGELOG.md",
    );
    expect(built.hardenDocsUrl("desktop.md")).toBe(
      "https://github.com/acme/harden-fork/blob/acme/work/docs/desktop.md",
    );
    expect(built.HARDEN_PACKAGE_NAME).toBe("@acme/harden");
    expect(built.HARDEN_COMMAND).toBe("harden");
    expect(built.HARDEN_PACKAGE_SEGMENTS).toEqual(["@acme", "harden"]);
    expect(built.HARDEN_INSTALL_COMMAND).toBe("npm i -g @acme/harden@latest");
    expect(built.hardenLatestReleaseUrl()).toBe(
      "https://github.com/acme/harden-fork/releases/latest",
    );
  });

  it("falls back to the defaults when an injected value is malformed", async () => {
    globals.__CODEHARDEN_PACKAGE__ = "../codeden";
    globals.__CODEHARDEN_REPOSITORY__ = "https://github.com/someone/else";
    globals.__CODEHARDEN_BRANCH__ = "../../other/repo";
    vi.resetModules();
    const built = await import("../src/index");
    expect(built.HARDEN_BRANCH).toBe("harden");
    expect(built.HARDEN_PACKAGE_NAME).toBe("codeharden");
    expect(built.HARDEN_REPOSITORY).toBe("harperaa/codeharden");
  });
});

describe("version ordering with CodeHarden versions", () => {
  it("orders npm-form CodeHarden versions by date and time", () => {
    const ordered = [
      "2026.105.518",
      "2026.105.1200",
      "2026.1122.905",
      "2026.1122.2006",
      "2026.1123.0",
      "2026.1123.905",
      "2027.101.0",
    ];
    for (let i = 1; i < ordered.length; i++) {
      const older = ordered[i - 1] as string;
      const newer = ordered[i] as string;
      expect(isNewerVersion(newer, older), `${newer} > ${older}`).toBe(true);
      expect(isNewerVersion(older, newer), `${older} < ${newer}`).toBe(false);
    }
    expect([...ordered].reverse().sort(compareVersions)).toEqual(ordered);
    expect(compareVersions("2026.1122.2006", "2026.1122.2006")).toBe(0);
  });

  it("compares fields as numbers, not text", () => {
    // As text "905" > "2006" and "105" > "1122"; as numbers they are older.
    expect(isNewerVersion("2026.1122.2006", "2026.1122.905")).toBe(true);
    expect(isNewerVersion("2026.1122.0", "2026.105.2359")).toBe(true);
  });

  it("puts every CodeHarden version above upstream's semver", () => {
    expect(isNewerVersion("2026.105.518", "0.7.7")).toBe(true);
    expect(isNewerVersion("2026.105.518", "99.0.0")).toBe(true);
    expect(isNewerVersion("0.7.8", "2026.105.518")).toBe(false);
  });

  it("orders the padded and the npm form of one version as equal", () => {
    expect(compareVersions("2026.0105.0518", "2026.105.518")).toBe(0);
  });
});
