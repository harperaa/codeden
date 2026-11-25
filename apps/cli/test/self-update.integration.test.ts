/**
 * Self-update end to end (§16) against a local fake registry serving the current build
 * relabelled as a newer version: check -> install with real npm -> current.json -> the launcher
 * of the published-style copy loads the new version, which reports its version.
 *
 * Needs `apps/cli/dist` (`pnpm build`); skipped without it unless CODEDEN_REQUIRE_CLI_DIST=1.
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { HARDEN_PACKAGE_NAME } from "@codeden/contracts";
import { installAppVersion, listInstalled, readPointer, UpdateService } from "@codeden/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLI_ROOT, type FakeRegistry, packCli, startFakeRegistry } from "./support/fake-registry";
import { installPublishedCopy } from "./support/published-install";

/** CodeHarden versions in their npm form: the published copy, and the newer one on the registry. */
const CURRENT = "2026.1122.2006";
const NEXT = "2026.1123.905";
/** A later version whose tarball is upstream's package under the channel's name. */
const MISLABELLED = "2026.1124.0";
/** What `--version` prints for a person, whichever copy answers. */
const VERSION_LINE = /^CodeHarden \d{4}\.\d{4}\.\d{4} · CodeDen \d+\.\d+\.\d+ \(upstream\)$/;
const built = existsSync(join(CLI_ROOT, "dist", "cli.js"));
if (!built && process.env.CODEDEN_REQUIRE_CLI_DIST === "1") {
  throw new Error("apps/cli/dist is missing: run `pnpm build` first");
}

describe.skipIf(!built)("self-update with a fake registry (§16)", () => {
  let registry: FakeRegistry;
  let base: string;
  let home: string;
  let entry: string;
  let current: string;
  const savedNpmConfig: NodeJS.ProcessEnv = {};
  const savedHomeEnv: NodeJS.ProcessEnv = {};

  const run = (args: string[], env: Record<string, string> = {}) =>
    execFileSync(process.execPath, [entry, ...args, "--home", home], {
      env: { ...process.env, CODEDEN_HOME: "", ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  /** Like `run`, without blocking this process: the registry it talks to is served from here. */
  const runWithRegistry = async (args: string[]) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [entry, ...args, "--home", home],
      { env: { ...process.env, CODEDEN_HOME: "", CODEDEN_UPDATE_REGISTRY: registry.url } },
    );
    return stdout.trim();
  };

  beforeAll(async () => {
    base = realpathSync.native(mkdtempSync(join(tmpdir(), "codeden-self-update-")));
    const npmUserConfig = join(base, ".npmrc");
    writeFileSync(npmUserConfig, "");
    // pnpm exports the user's npm config as npm_config_*; keep it out of the real npm install.
    for (const key of Object.keys(process.env)) {
      if (key.toLowerCase().startsWith("npm_config_")) {
        savedNpmConfig[key] = process.env[key];
        delete process.env[key];
      }
    }
    process.env.NPM_CONFIG_USERCONFIG = npmUserConfig;
    for (const key of ["HOME", "USERPROFILE"]) {
      savedHomeEnv[key] = process.env[key];
      process.env[key] = base;
    }
    home = join(base, "home");
    // Linked runtime deps in <base>/node_modules also serve the version installed under <base>/home.
    entry = installPublishedCopy(base, { version: CURRENT, linkDeps: true });
    // The updater's probe: the bare package version (plain `--version` prints the version line).
    current = run(["--version"], { CODEDEN_NO_SWITCH: "1" });
    registry = await startFakeRegistry();
    registry.publish(NEXT, packCli({ version: NEXT, stripDependencies: true }));
    registry.publish(
      MISLABELLED,
      packCli({ version: MISLABELLED, stripDependencies: true, name: "codeden" }),
      { latest: false },
    );
    expect(current).toBe(CURRENT);
    // A leaked dry-run setting would make npm skip installing the update.
    process.env.npm_config_dry_run = "true";
  }, 120_000);

  afterAll(async () => {
    for (const [key, value] of Object.entries(savedHomeEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.NPM_CONFIG_USERCONFIG;
    for (const key of Object.keys(process.env)) {
      if (key.toLowerCase().startsWith("npm_config_")) delete process.env[key];
    }
    Object.assign(process.env, savedNpmConfig);
    await registry?.close();
    rmSync(base, { recursive: true, force: true, maxRetries: 3 });
  });

  it("checks, installs side by side, switches and reports the new version", async () => {
    const restarts: Array<string | null> = [];
    const updates = new UpdateService({
      home,
      mode: () => "notify",
      registry: registry.url,
      current,
      host: {
        source: "packaged",
        restartCommand: HARDEN_PACKAGE_NAME,
        launcherVersion: current,
        restart: ({ version }) => restarts.push(version),
      },
    });
    const checked = await updates.status({ refresh: true });
    expect(checked).toMatchObject({ current, latest: NEXT, updateAvailable: true, error: null });

    updates.install();
    const deadline = Date.now() + 240_000;
    while (restarts.length === 0 && updates.snapshot().state !== "failed") {
      if (Date.now() > deadline) throw new Error("install timed out");
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(updates.snapshot().installError).toBeNull();
    expect(restarts).toEqual([NEXT]);
    expect(readPointer(home)).toMatchObject({ version: NEXT, previous: current });
    expect(listInstalled(home)).toEqual([{ version: NEXT, current: true, valid: true }]);
    expect(registry.requests).toContain(`GET /-/package/${HARDEN_PACKAGE_NAME}/dist-tags`);
    // Nothing was asked of the registry under upstream's package name.
    expect(registry.requests.filter((r) => /\/codeden(\/|$)/.test(r))).toEqual([]);
    expect(existsSync(join(home, "app", NEXT, "node_modules", HARDEN_PACKAGE_NAME, "dist"))).toBe(
      true,
    );

    // The published-style copy's launcher now loads the installed version in-process.
    // It answers with the version line, which doesn't name the package version; the pointer and
    // the installed list above do.
    expect(run(["--version"])).toMatch(VERSION_LINE);
    expect(run(["--version"], { CODEDEN_NO_SWITCH: "1" })).toBe(current);
    // doctor exits non-zero without an agent CLI installed (CI); only its rows matter here.
    const doctor = spawnSync(process.execPath, [entry, "doctor", "--home", home], {
      encoding: "utf8",
    });
    expect(doctor.stdout, doctor.stderr).toContain(`Installed versions   ${NEXT} (current)`);
  }, 300_000);

  it("rolls back to the launched copy, and `update` installs and switches again", async () => {
    const rolledBack = run(["update", "--rollback"]);
    expect(rolledBack).toContain(`Rolled back. CodeHarden ${CURRENT} starts next time`);
    expect(readPointer(home)).toBeNull();
    expect(listInstalled(home)).toEqual([{ version: NEXT, current: false, valid: true }]);

    const updated = await runWithRegistry(["update"]);
    expect(updated).toContain(`Updated to ${NEXT}.`);
    expect(readPointer(home)).toMatchObject({ version: NEXT, previous: CURRENT });
    // Now running as NEXT, there is nothing newer.
    expect(await runWithRegistry(["update"])).toContain(
      `CodeHarden ${NEXT} is the latest version.`,
    );
  }, 120_000);

  it("refuses a fetched package that is not the channel's package", async () => {
    await expect(
      installAppVersion({ home, version: MISLABELLED, registry: registry.url }),
    ).rejects.toThrow(`it is the package codeden, not ${HARDEN_PACKAGE_NAME}`);
    expect(existsSync(join(home, "app", MISLABELLED))).toBe(false);
    expect(readPointer(home)).toMatchObject({ version: NEXT });
    expect(listInstalled(home).map((v) => v.version)).toEqual([NEXT]);
  }, 300_000);

  it("falls back to the launched copy when the pinned version is broken", () => {
    const pkg = join(home, "app", NEXT, "node_modules", HARDEN_PACKAGE_NAME, "package.json");
    writeFileSync(pkg, JSON.stringify({ name: HARDEN_PACKAGE_NAME, version: "0.0.1" }));
    const out = execFileSync(process.execPath, [entry, "--version", "--home", home], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out.trim()).toMatch(VERSION_LINE);
  });
});
