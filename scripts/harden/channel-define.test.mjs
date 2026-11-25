import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HARDEN_APP_ID,
  HARDEN_APP_SLUG,
  HARDEN_BRANCH,
  HARDEN_DEFAULT_PORT,
  HARDEN_PACKAGE_NAME,
  HARDEN_PRODUCT_NAME,
  HARDEN_REPOSITORY,
  HARDEN_TEMPLATE_BRANCH,
  HARDEN_TEMPLATE_REPOSITORY,
} from "../../packages/contracts/src/harden-channel.ts";
import {
  DEFAULT_APP_ID,
  DEFAULT_APP_SLUG,
  DEFAULT_HARDEN_BRANCH,
  DEFAULT_PACKAGE_NAME,
  DEFAULT_PORT,
  DEFAULT_PRODUCT_NAME,
  DEFAULT_RELEASE_REPOSITORY,
  DEFAULT_TEMPLATE_BRANCH,
  DEFAULT_TEMPLATE_REPOSITORY,
  hardenChannelDefine,
  isReleasePack,
  readHardenChannel,
  repositoryOfRemote,
  slugOfPackage,
} from "./channel-define.mjs";

const OWN = { origin: "harperaa/codeharden" };
const FORK = { origin: "example/example-harden" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the build-time update channel", () => {
  it("defaults to CodeHarden's package, repository and branch, as the contracts module does", () => {
    for (const options of [OWN, { origin: null }, { origin: "HarperAA/CodeHarden" }]) {
      expect(readHardenChannel({}, options)).toMatchObject({
        packageName: "codeharden",
        owner: "harperaa",
        repo: "codeharden",
        branch: "harden",
      });
    }
    expect(readHardenChannel({}, OWN).repository).toBe("harperaa/codeharden");
    expect(DEFAULT_PACKAGE_NAME).toBe(HARDEN_PACKAGE_NAME);
    expect(DEFAULT_RELEASE_REPOSITORY).toBe(HARDEN_REPOSITORY);
    expect(DEFAULT_HARDEN_BRANCH).toBe(HARDEN_BRANCH);
  });

  it("takes PACKAGE_NAME, RELEASE_REPOSITORY and HARDEN_BRANCH from the build environment", () => {
    const env = {
      PACKAGE_NAME: "@acme/harden",
      RELEASE_REPOSITORY: "acme/harden-fork",
      HARDEN_BRANCH: "work",
    };
    expect(readHardenChannel(env, OWN)).toMatchObject({ owner: "acme", repo: "harden-fork" });
    expect(hardenChannelDefine(env, OWN)).toEqual({
      __CODEHARDEN_PACKAGE__: '"@acme/harden"',
      __CODEHARDEN_REPOSITORY__: '"acme/harden-fork"',
      __CODEHARDEN_BRANCH__: '"work"',
      __CODEHARDEN_PRODUCT__: '"harden"',
      __CODEHARDEN_APP_ID__: '"com.harden.app"',
      __CODEHARDEN_SLUG__: '"harden"',
      __CODEHARDEN_PORT__: "4417",
      __CODEHARDEN_TEMPLATE_REPOSITORY__: '"harperaa/secure-vibe-coding-OS"',
      __CODEHARDEN_TEMPLATE_BRANCH__: '"main"',
    });
  });

  it("takes the release repository from the origin remote, so a fork needs no variable for it", () => {
    const define = hardenChannelDefine({ PACKAGE_NAME: "example-harden" }, FORK);
    expect(define).toEqual({
      __CODEHARDEN_PACKAGE__: '"example-harden"',
      __CODEHARDEN_REPOSITORY__: '"example/example-harden"',
      __CODEHARDEN_BRANCH__: '"harden"',
      __CODEHARDEN_PRODUCT__: '"example-harden"',
      __CODEHARDEN_APP_ID__: '"com.exampleharden.app"',
      __CODEHARDEN_SLUG__: '"exampleharden"',
      __CODEHARDEN_PORT__: "4417",
      __CODEHARDEN_TEMPLATE_REPOSITORY__: '"harperaa/secure-vibe-coding-OS"',
      __CODEHARDEN_TEMPLATE_BRANCH__: '"main"',
    });
    expect(JSON.stringify(define)).not.toContain("codeharden");
    // The environment still wins over the remote.
    expect(
      readHardenChannel({ PACKAGE_NAME: "x", RELEASE_REPOSITORY: "other/place" }, FORK).repository,
    ).toBe("other/place");
  });

  it("reads owner/repo from GitHub remote URLs only", () => {
    for (const url of [
      "https://github.com/example/example-harden",
      "https://github.com/example/example-harden.git\n",
      "git@github.com:example/example-harden.git",
      "ssh://git@github.com/example/example-harden.git",
    ]) {
      expect(repositoryOfRemote(url)).toBe("example/example-harden");
    }
    for (const url of [
      "",
      "/tmp/somewhere.git",
      "https://example.com/a/b",
      "https://github.com/a/b/c",
    ]) {
      expect(repositoryOfRemote(url)).toBeNull();
    }
  });

  it("treats empty variables as unset", () => {
    expect(
      hardenChannelDefine({ PACKAGE_NAME: "", RELEASE_REPOSITORY: " ", HARDEN_BRANCH: "" }, OWN),
    ).toEqual({
      __CODEHARDEN_PACKAGE__: '"codeharden"',
      __CODEHARDEN_REPOSITORY__: '"harperaa/codeharden"',
      __CODEHARDEN_BRANCH__: '"harden"',
      __CODEHARDEN_PRODUCT__: '"CodeHarden"',
      __CODEHARDEN_APP_ID__: '"com.codeharden.app"',
      __CODEHARDEN_SLUG__: '"codeharden"',
      __CODEHARDEN_PORT__: "4417",
      __CODEHARDEN_TEMPLATE_REPOSITORY__: '"harperaa/secure-vibe-coding-OS"',
      __CODEHARDEN_TEMPLATE_BRANCH__: '"main"',
    });
  });

  it("refuses a malformed package name, repository or branch instead of building with it", () => {
    expect(() => readHardenChannel({ PACKAGE_NAME: "Code Harden" }, OWN)).toThrow(/PACKAGE_NAME/);
    expect(() => readHardenChannel({ PACKAGE_NAME: "../codeden" }, OWN)).toThrow(/PACKAGE_NAME/);
    expect(() =>
      readHardenChannel({ RELEASE_REPOSITORY: "https://github.com/harperaa/codeharden" }, OWN),
    ).toThrow(/RELEASE_REPOSITORY/);
    for (const branch of ["a b", "../x", "x..y", "-x", "x/", "x.lock"]) {
      expect(() => readHardenChannel({ HARDEN_BRANCH: branch }, OWN)).toThrow(/HARDEN_BRANCH/);
    }
  });

  it("gives CodeHarden its own identity, the one the contracts module defaults to", () => {
    expect(readHardenChannel({}, OWN)).toMatchObject({
      productName: "CodeHarden",
      appId: "com.codeharden.app",
      slug: "codeharden",
      port: 4417,
    });
    expect(DEFAULT_PRODUCT_NAME).toBe(HARDEN_PRODUCT_NAME);
    expect(DEFAULT_APP_ID).toBe(HARDEN_APP_ID);
    expect(DEFAULT_APP_SLUG).toBe(HARDEN_APP_SLUG);
    expect(DEFAULT_PORT).toBe(HARDEN_DEFAULT_PORT);
    // Never upstream's: the two must install and run side by side.
    expect(HARDEN_APP_ID).not.toBe("dev.codeden.app");
    expect(HARDEN_APP_SLUG).not.toBe("codeden");
    expect(HARDEN_DEFAULT_PORT).not.toBe(4317);
  });

  it("derives a fork's identity from its package name, so it never installs as CodeHarden", () => {
    expect(slugOfPackage("@acme/my_harden.cli")).toBe("myhardencli");
    expect(slugOfPackage("9lives")).toBe("app9lives");
    const fork = readHardenChannel({ PACKAGE_NAME: "example-harden" }, FORK);
    expect(fork).toMatchObject({
      productName: "example-harden",
      appId: "com.exampleharden.app",
      slug: "exampleharden",
    });
    expect(
      readHardenChannel(
        {
          PACKAGE_NAME: "example-harden",
          PRODUCT_NAME: "Example Harden",
          APP_ID: "org.example.harden",
          DEFAULT_PORT: "4500",
        },
        FORK,
      ),
    ).toMatchObject({ productName: "Example Harden", appId: "org.example.harden", port: 4500 });
  });

  it("names the Secure Foundation template, which a fork can replace or switch off", () => {
    expect(readHardenChannel({}, OWN)).toMatchObject({
      templateRepository: "harperaa/secure-vibe-coding-OS",
      templateBranch: "main",
    });
    expect(DEFAULT_TEMPLATE_REPOSITORY).toBe(HARDEN_TEMPLATE_REPOSITORY);
    expect(DEFAULT_TEMPLATE_BRANCH).toBe(HARDEN_TEMPLATE_BRANCH);
    // A fork keeps the default unless it sets its own.
    expect(readHardenChannel({ PACKAGE_NAME: "example-harden" }, FORK).templateRepository).toBe(
      DEFAULT_TEMPLATE_REPOSITORY,
    );
    expect(
      readHardenChannel({ TEMPLATE_REPOSITORY: "acme/starter", TEMPLATE_BRANCH: "stable" }, OWN),
    ).toMatchObject({ templateRepository: "acme/starter", templateBranch: "stable" });
    for (const off of ["none", "NONE", " none "]) {
      expect(readHardenChannel({ TEMPLATE_REPOSITORY: off }, OWN).templateRepository).toBe("");
    }
    // An empty variable is an unset one (a workflow passes an unset variable as "").
    for (const unset of ["", "  "]) {
      expect(readHardenChannel({ TEMPLATE_REPOSITORY: unset }, OWN).templateRepository).toBe(
        DEFAULT_TEMPLATE_REPOSITORY,
      );
    }
    expect(hardenChannelDefine({ TEMPLATE_REPOSITORY: "none" }, OWN)).toMatchObject({
      __CODEHARDEN_TEMPLATE_REPOSITORY__: '""',
      __CODEHARDEN_TEMPLATE_BRANCH__: '"main"',
    });
    for (const bad of ["https://github.com/acme/starter", "acme", "acme/..", "a b/c"]) {
      expect(() => readHardenChannel({ TEMPLATE_REPOSITORY: bad }, OWN)).toThrow(
        /TEMPLATE_REPOSITORY/,
      );
    }
    for (const bad of ["a b", "../x", "x..y", "-x"]) {
      expect(() => readHardenChannel({ TEMPLATE_BRANCH: bad }, OWN)).toThrow(/TEMPLATE_BRANCH/);
    }
  });

  it("refuses a malformed product name, app id or port", () => {
    expect(() => readHardenChannel({ PRODUCT_NAME: "Code/Harden" }, OWN)).toThrow(/PRODUCT_NAME/);
    expect(() => readHardenChannel({ APP_ID: "codeharden" }, OWN)).toThrow(/APP_ID/);
    for (const port of ["80", "70000", "x", "4417.5"]) {
      expect(() => readHardenChannel({ DEFAULT_PORT: port }, OWN)).toThrow(/DEFAULT_PORT/);
    }
    expect(() => readHardenChannel({ PACKAGE_NAME: "---" }, OWN)).toThrow(/PACKAGE_NAME/);
  });

  it("only warns when an ordinary build in another repository has no PACKAGE_NAME", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = readHardenChannel({}, FORK);
    expect(channel).toMatchObject({ packageName: "codeharden", repository: FORK.origin });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("PACKAGE_NAME");
    // Once per process, and never in CodeHarden itself or without a GitHub origin.
    readHardenChannel({}, FORK);
    readHardenChannel({}, OWN);
    readHardenChannel({}, { origin: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("refuses to pack a release as codeharden outside CodeHarden's own repository", () => {
    expect(readHardenChannel({}, { ...OWN, strict: true }).packageName).toBe("codeharden");
    expect(() => readHardenChannel({}, { ...FORK, strict: true })).toThrow(
      /PACKAGE_NAME is not set.*example\/example-harden/,
    );
    expect(() => readHardenChannel({}, { origin: null, strict: true })).toThrow(/PACKAGE_NAME/);
    expect(() =>
      readHardenChannel({ PACKAGE_NAME: "example-harden" }, { origin: null, strict: true }),
    ).toThrow(/RELEASE_REPOSITORY/);
    expect(
      readHardenChannel({ PACKAGE_NAME: "example-harden" }, { ...FORK, strict: true }),
    ).toMatchObject({ packageName: "example-harden", repository: "example/example-harden" });
  });

  it("is strict when the environment says a release is packed (the desktop installers)", () => {
    const PACK = { HARDEN_RELEASE_PACK: "1" };
    // A fork that has not named its package: refused, with what to do.
    expect(() => readHardenChannel(PACK, FORK)).toThrow(
      /PACKAGE_NAME is not set.*example\/example-harden.*setup-fork\.sh/,
    );
    expect(() => readHardenChannel(PACK, { origin: null })).toThrow(/PACKAGE_NAME/);
    expect(() =>
      readHardenChannel({ ...PACK, PACKAGE_NAME: "example-harden" }, FORK),
    ).not.toThrow();
    expect(() =>
      readHardenChannel({ ...PACK, PACKAGE_NAME: "example-harden" }, { origin: null }),
    ).toThrow(/RELEASE_REPOSITORY/);
    // CodeHarden's own checkout, and what its installer workflow passes, resolve as ever.
    expect(readHardenChannel(PACK, OWN)).toEqual(readHardenChannel({}, OWN));
    const workflow = { PACKAGE_NAME: "codeharden", RELEASE_REPOSITORY: "harperaa/codeharden" };
    for (const origin of [OWN.origin, null]) {
      expect(readHardenChannel({ ...PACK, ...workflow }, { origin })).toEqual(
        readHardenChannel({}, OWN),
      );
    }
    // Off unless it says 1; an explicit option wins; anything else is an error, not a "no".
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const off of [{}, { HARDEN_RELEASE_PACK: "" }, { HARDEN_RELEASE_PACK: "0" }]) {
      expect(isReleasePack(off)).toBe(false);
      expect(readHardenChannel(off, FORK).packageName).toBe("codeharden");
    }
    expect(readHardenChannel(PACK, { ...FORK, strict: false }).packageName).toBe("codeharden");
    expect(() => readHardenChannel({ HARDEN_RELEASE_PACK: "true" }, OWN)).toThrow(
      /HARDEN_RELEASE_PACK must be 1, 0 or unset/,
    );
  });
});
