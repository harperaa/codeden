/**
 * CodeHarden's update channel in the server's update code: the registry is asked for the
 * channel's package, CodeHarden versions order and validate as versions, release links use the
 * padded tag, and an install that isn't the channel's package is refused.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedCommand } from "@codeden/providers";
import { afterEach, describe, expect, it } from "vitest";
import {
  cliEntry,
  installProblem,
  isVersionName,
  listInstalled,
  PACKAGE_NAME,
  packageRoot,
  readPointer,
  rollbackTarget,
  writePointer,
} from "../src/services/updates/app-dir";
import { DESKTOP_RELEASES_URL } from "../src/services/updates/desktop";
import { installAppVersion } from "../src/services/updates/installer";
import {
  DEFAULT_REGISTRY,
  fetchLatestVersion,
  fetchReleaseNotes,
  registryPackagePath,
  updateRegistry,
} from "../src/services/updates/registry";
import { UpdateService } from "../src/services/updates/service";

const CURRENT = "2026.1122.2006";
const NEXT = "2026.1123.905";
const fakeNpm: ResolvedCommand = {
  kind: "node-script",
  path: process.execPath,
  script: join(import.meta.dirname, "fixtures", "fake-npm-codeden", "npm-cli.mjs"),
};
const tempHome = () => mkdtempSync(join(tmpdir(), "codeharden-updates-"));

function fakeInstall(home: string, version: string, name = PACKAGE_NAME): void {
  const root = packageRoot(home, version);
  mkdirSync(join(root, "dist", "web"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, version }));
  for (const f of ["dist/cli.js", "dist/runner.js", "dist/web/index.html"]) {
    writeFileSync(join(root, f), "");
  }
}

afterEach(() => {
  delete process.env.FAKE_NPM_NAME;
});

describe("the self-update channel", () => {
  it("installs the channel's package, side by side under its own name", () => {
    expect(PACKAGE_NAME).toBe("codeharden");
    expect(packageRoot("/h", NEXT)).toBe(join("/h", "app", NEXT, "node_modules", "codeharden"));
    expect(cliEntry("/h", NEXT)).toBe(
      join("/h", "app", NEXT, "node_modules", "codeharden", "dist", "cli.js"),
    );
  });

  it("asks the registry for the channel's package only", async () => {
    const calls: string[] = [];
    const fetch = (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ latest: NEXT }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    expect(await fetchLatestVersion(DEFAULT_REGISTRY, fetch)).toBe(NEXT);
    expect(calls).toEqual(["https://registry.npmjs.org/-/package/codeharden/dist-tags"]);
  });

  it("writes a package name as one path segment of the registry URL", () => {
    expect(registryPackagePath("codeharden")).toBe("codeharden");
    expect(registryPackagePath("@acme/harden")).toBe("@acme%2fharden");
    // Nothing in a name can add a path segment or a query, whatever it contains.
    expect(registryPackagePath("@a/b/c")).toBe("@a%2fb%2fc");
    expect(registryPackagePath("a b?c#d")).toBe("a%20b%3Fc%23d");
    expect(registryPackagePath("../x")).toBe("..%2fx");
  });

  it("has no runtime override for the package, only the tests' registry URL", () => {
    const env = { PACKAGE_NAME: "codeden", CODEDEN_UPDATE_REGISTRY: "http://127.0.0.1:1/" };
    expect(updateRegistry(env)).toBe("http://127.0.0.1:1");
    expect(updateRegistry({ PACKAGE_NAME: "codeden" })).toBe(DEFAULT_REGISTRY);
    expect(PACKAGE_NAME).toBe("codeharden");
  });

  it("accepts CodeHarden versions as version names", () => {
    for (const v of [CURRENT, NEXT, "2026.105.518", "2026.101.0"]) {
      expect(isVersionName(v), v).toBe(true);
    }
    expect(isVersionName("../2026.105.518")).toBe(false);
  });

  it("offers a newer CodeHarden version, installs it and can roll back", async () => {
    const home = tempHome();
    const restarts: Array<string | null> = [];
    const fetch = (async () =>
      new Response(JSON.stringify({ latest: NEXT }), { status: 200 })) as typeof globalThis.fetch;
    const updates = new UpdateService({
      home,
      mode: () => "notify",
      registry: "http://registry.test",
      fetch,
      current: CURRENT,
      install: (opts) => installAppVersion({ ...opts, npm: fakeNpm }),
      host: {
        source: "packaged",
        restartCommand: "codeharden",
        launcherVersion: CURRENT,
        restart: ({ version }) => restarts.push(version),
      },
    });
    expect(await updates.status({ refresh: true })).toMatchObject({
      current: CURRENT,
      latest: NEXT,
      updateAvailable: true,
      command: "npm i -g codeharden@latest",
    });
    updates.install({ restart: false });
    const deadline = Date.now() + 60_000;
    while (!readPointer(home) && updates.snapshot().state !== "failed") {
      if (Date.now() > deadline) throw new Error("install timed out");
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(updates.snapshot()).toMatchObject({ state: "installed", target: NEXT });
    expect(readPointer(home)).toMatchObject({ version: NEXT, previous: CURRENT });
    expect(listInstalled(home)).toEqual([{ version: NEXT, current: true, valid: true }]);
    expect(existsSync(cliEntry(home, NEXT))).toBe(true);

    // An even newer one on top: the previous install is the rollback target.
    const LATER = "2026.1201.0";
    fakeInstall(home, LATER);
    writePointer(home, LATER, NEXT);
    expect(listInstalled(home).map((v) => v.version)).toEqual([LATER, NEXT]);
    expect(rollbackTarget(home, CURRENT)).toBe(NEXT);
    updates.rollback();
    expect(readPointer(home)).toMatchObject({ version: NEXT, previous: LATER });
  });

  it("is up to date when the registry's latest is the running version or older", async () => {
    for (const latest of [CURRENT, "2026.1122.905", "2026.105.2359", "0.7.8"]) {
      const fetch = (async () =>
        new Response(JSON.stringify({ latest }), { status: 200 })) as typeof globalThis.fetch;
      const updates = new UpdateService({
        home: tempHome(),
        mode: () => "notify",
        registry: "http://registry.test",
        fetch,
        current: CURRENT,
      });
      expect((await updates.status({ refresh: true })).updateAvailable, latest).toBe(false);
    }
  });
});

describe("refusing a package that isn't the channel's", () => {
  it("reports an install whose package.json names another package", () => {
    const home = tempHome();
    fakeInstall(home, NEXT, "codeden");
    expect(installProblem(packageRoot(home, NEXT), NEXT)).toBe(
      "it is the package codeden, not codeharden",
    );
    expect(listInstalled(home)).toEqual([{ version: NEXT, current: false, valid: false }]);
    fakeInstall(home, NEXT);
    expect(installProblem(packageRoot(home, NEXT), NEXT)).toBeNull();
  });

  it("fails the install of a fetched package with the wrong name and leaves nothing behind", async () => {
    const home = tempHome();
    process.env.FAKE_NPM_NAME = "codeden";
    await expect(installAppVersion({ home, version: NEXT, npm: fakeNpm })).rejects.toThrow(
      "it is the package codeden, not codeharden",
    );
    expect(existsSync(join(home, "app", NEXT))).toBe(false);
    expect(readdirSync(join(home, "app")).filter((n) => n.startsWith(".staging-"))).toEqual([]);
    expect(readPointer(home)).toBeNull();
  });
});

describe("release links", () => {
  const fetchWith = (release: unknown, changelog?: string) => {
    const calls: string[] = [];
    const fetch = (async (url: string) => {
      calls.push(String(url));
      if (new URL(String(url)).hostname === "api.github.com") {
        return release
          ? new Response(JSON.stringify(release), { status: 200 })
          : new Response("{}", { status: 404 });
      }
      return changelog
        ? new Response(changelog, { status: 200 })
        : new Response("", { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    return { fetch, calls };
  };

  it("looks a version's notes up under its padded tag in CodeHarden's repository", async () => {
    const { fetch, calls } = fetchWith(null);
    const notes = await fetchReleaseNotes("2026.105.518", {}, fetch);
    expect(notes).toEqual({
      version: "2026.105.518",
      body: null,
      url: "https://github.com/harperaa/codeharden/releases/tag/v2026.0105.0518",
    });
    expect(calls).toEqual([
      "https://api.github.com/repos/harperaa/codeharden/releases/tags/v2026.0105.0518",
      "https://raw.githubusercontent.com/harperaa/codeharden/harden/CODEHARDEN-CHANGELOG.md",
    ]);
  });

  it("falls back to the CodeHarden changelog's section for the padded version", async () => {
    const changelog = [
      "# CodeHarden releases",
      "",
      "## 2026.0105.0518 — 2026-01-05 05:18",
      "",
      "- self-update from the codeharden package",
      "",
      "## 2026.0104.1200 — 2026-01-04 12:00",
      "",
      "- older",
    ].join("\n");
    const { fetch } = fetchWith(null, changelog);
    const notes = await fetchReleaseNotes("2026.105.518", {}, fetch);
    expect(notes.body).toBe("- self-update from the codeharden package");
  });

  it("sends desktop users to CodeHarden's releases", () => {
    expect(DESKTOP_RELEASES_URL).toBe("https://github.com/harperaa/codeharden/releases/latest");
  });
});
