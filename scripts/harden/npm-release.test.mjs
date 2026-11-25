import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hardenNpmVersion } from "../../packages/contracts/src/harden-channel.ts";
import {
  commandName,
  NPM_REGISTRY,
  npmVersion,
  releaseManifest,
  releaseReadme,
  tarballName,
  tarballProblems,
} from "./npm-release.mjs";
import {
  loginCommand,
  loginIntro,
  notSignedInMessage,
  publishFailureMessage,
  signedInMessage,
} from "./npm-release-messages.mjs";

const channel = { packageName: "codeharden", repository: "harperaa/codeharden" };
const release = { hardenVersion: "2026.0105.0518", channel };
const repoPackage = JSON.parse(
  readFileSync(new URL("../../apps/cli/package.json", import.meta.url), "utf8"),
);

function unpacked(manifest, files = []) {
  const dir = mkdtempSync(join(tmpdir(), "codeharden-npm-test-"));
  const all = ["README.md", "LICENSE", "dist/cli.js", "dist/runner.js", "dist/web/index.html"];
  for (const file of [...all, "dist/THIRD-PARTY-NOTICES.txt", ...files]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "");
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}

describe("the npm release", () => {
  it("strips the leading zeros of a CodeHarden version, as the app's own mapping does", () => {
    for (const version of [
      "2026.0105.0518",
      "2026.1122.2006",
      "2026.0101.0000",
      "2027.1231.2359",
    ]) {
      expect(npmVersion(version)).toBe(hardenNpmVersion(version));
    }
    expect(npmVersion("2026.0105.0518")).toBe("2026.105.518");
    expect(() => npmVersion("0.7.7")).toThrow(/not a CodeHarden version/);
    expect(() => npmVersion("2026.105.518")).toThrow(/not a CodeHarden version/);
  });

  it("names the command and the tarball after the package", () => {
    expect(commandName("codeharden")).toBe("codeharden");
    expect(commandName("@acme/harden")).toBe("harden");
    expect(tarballName("codeharden", "2026.105.518")).toBe("codeharden-2026.105.518.tgz");
    expect(tarballName("@acme/harden", "2026.105.518")).toBe("acme-harden-2026.105.518.tgz");
  });

  it("writes the release manifest from the repository's package.json", () => {
    // The repository keeps upstream's name: the rename happens only here.
    expect(repoPackage.name).toBe("codeden");
    const manifest = releaseManifest(repoPackage, release);
    expect(manifest).toMatchObject({
      name: "codeharden",
      version: "2026.105.518",
      bin: { codeharden: "./dist/cli.js" },
      repository: { type: "git", url: "git+https://github.com/harperaa/codeharden.git" },
      bugs: { url: "https://github.com/harperaa/codeharden/issues" },
      license: repoPackage.license,
      type: "module",
      files: repoPackage.files,
      engines: repoPackage.engines,
      dependencies: repoPackage.dependencies,
    });
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.scripts).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain("workspace:");
    expect(JSON.stringify(manifest)).not.toContain("leonvanzyl");
    // The repository's own file is untouched.
    expect(repoPackage.bin).toEqual({ codeden: "./dist/cli.js" });
  });

  it("makes the README's relative links absolute, into the channel's repository", () => {
    const readme = "[a](docs/x.md) ![s](./docs/shot.png) [b](https://example.com) [c](#top)";
    expect(releaseReadme(readme, "harperaa/codeharden")).toBe(
      "[a](https://github.com/harperaa/codeharden/blob/harden/docs/x.md) " +
        "![s](https://raw.githubusercontent.com/harperaa/codeharden/harden/docs/shot.png) " +
        "[b](https://example.com) [c](#top)",
    );
  });

  it("accepts a tarball packed from the release manifest", () => {
    expect(tarballProblems(unpacked(releaseManifest(repoPackage, release)), release)).toEqual([]);
  });

  it("refuses a tarball that is still upstream's package, or the wrong version", () => {
    const upstream = tarballProblems(unpacked(repoPackage), release);
    expect(upstream).toContain("name is codeden, not codeharden");
    expect(upstream.join("\n")).toMatch(/version is .*, not 2026\.105\.518/);
    expect(upstream.join("\n")).toMatch(/bin is .*not the codeharden command/);
    expect(upstream).toContain("repository does not point at harperaa/codeharden");
    expect(upstream).toContain("workspace-only fields were not removed");
    const older = releaseManifest(repoPackage, { ...release, hardenVersion: "2026.0104.0000" });
    expect(tarballProblems(unpacked(older), release)).toEqual([
      "version is 2026.104.0, not 2026.105.518",
    ]);
  });

  it("refuses a tarball with sources in it or files missing", () => {
    const manifest = releaseManifest(repoPackage, release);
    expect(tarballProblems(unpacked(manifest, ["src/cli.ts"]), release)).toEqual([
      "src must not be in the package",
    ]);
    const dir = mkdtempSync(join(tmpdir(), "codeharden-npm-test-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    expect(tarballProblems(dir, release)).toContain("dist/cli.js is missing");
  });

  it("publishes to the public registry unless told otherwise", () => {
    expect(NPM_REGISTRY).toBe("https://registry.npmjs.org");
  });
});

describe("the npm release's sign-in and failure messages", () => {
  const failed = { packageName: "codeharden", version: "2026.105.518" };

  it("names the fix in one line when nobody is signed in", () => {
    const message = notSignedInMessage();
    expect(message).not.toContain("\n");
    expect(message).toContain("npm is not signed in to https://registry.npmjs.org");
    expect(message).toContain("node scripts/harden/npm-release.mjs login");
    expect(loginCommand()).toBe("node scripts/harden/npm-release.mjs login");
    expect(loginCommand("http://127.0.0.1:1")).toBe(
      "node scripts/harden/npm-release.mjs login --registry http://127.0.0.1:1",
    );
  });

  it("explains a failed publish when the sign-in is gone: sign in, publish again", () => {
    const message = publishFailureMessage({ ...failed, user: null, published: false });
    expect(message).toContain("nothing was published");
    expect(message).toContain("whoami now shows nobody");
    expect(message).toContain("E404");
    expect(message).toContain(
      "publish the same version again: node scripts/harden/npm-release.mjs login",
    );
  });

  it("explains E404 when somebody is signed in: the account, not the package", () => {
    const message = publishFailureMessage({ ...failed, user: "someone", published: false });
    expect(message).toContain("If npm said E404");
    expect(message).toContain("almost always about the sign-in, not the package");
    expect(message).toContain("404, not 401");
    expect(message).toContain("npm is signed in as someone");
    expect(message).toContain("no publish rights on codeharden: then stop");
    expect(message).toContain("same version can be");
  });

  it("never tells anyone to publish again when the registry lists the version", () => {
    const message = publishFailureMessage({ ...failed, user: null, published: true });
    expect(message).toContain("codeharden@2026.105.518: it is published");
    expect(message).not.toContain("login");
  });

  it("says where the sign-in stays and how to sign out, and never asks for a secret", () => {
    expect(signedInMessage("someone")).toContain(
      "Signed in to https://registry.npmjs.org as someone",
    );
    expect(signedInMessage("someone")).toMatch(/on this computer.*\n {2}npm logout$/);
    expect(signedInMessage("someone", "http://127.0.0.1:1")).toMatch(
      /npm logout --registry http:\/\/127\.0\.0\.1:1$/,
    );
    expect(loginIntro()).toContain("nothing secret is typed into this command");
  });
});

// The `login` command with a stub `npm` first on PATH: nothing here reaches npm or a registry.
describe("npm-release.mjs login", () => {
  const SCRIPT = fileURLToPath(new URL("./npm-release.mjs", import.meta.url));
  const REGISTRY = "http://127.0.0.1:9";

  function login({ loginExit = 0, user = "someone" } = {}) {
    const bin = mkdtempSync(join(tmpdir(), "codeharden-npm-stub-"));
    const calls = join(bin, "calls");
    writeFileSync(
      join(bin, "npm"),
      `#!/bin/sh
echo "$*" >> "${calls}"
case "$1" in
  login) exit ${loginExit} ;;
  whoami) [ -n "${user}" ] || exit 1; echo "${user}" ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(join(bin, "npm"), 0o755);
    const result = spawnSync(process.execPath, [SCRIPT, "login", "--registry", REGISTRY], {
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: bin },
    });
    let ran = [];
    try {
      ran = readFileSync(calls, "utf8").trim().split("\n");
    } catch {
      // npm was never called
    }
    return { code: result.status, out: result.stdout, err: result.stderr, ran };
  }

  it.skipIf(process.platform === "win32")(
    "signs in with the web flow only, on the named registry, then says who and how to sign out",
    () => {
      const result = login();
      expect(result.code).toBe(0);
      expect(result.ran).toEqual([
        `login --auth-type=web --registry ${REGISTRY}`,
        `whoami --registry ${REGISTRY}`,
      ]);
      expect(result.out).toContain(`Signed in to ${REGISTRY} as someone.`);
      expect(result.out).toContain(`npm logout --registry ${REGISTRY}`);
    },
  );

  it.skipIf(process.platform === "win32")(
    "fails when npm did not finish, or finished with nobody signed in",
    () => {
      const stopped = login({ loginExit: 1 });
      expect(stopped.code).toBe(1);
      expect(stopped.err).toContain("npm login did not finish");
      expect(stopped.ran).toHaveLength(1);
      const nobody = login({ user: "" });
      expect(nobody.code).toBe(1);
      expect(nobody.err).toContain("still shows nobody");
      expect(nobody.out).not.toContain("Signed in to");
    },
  );
});
