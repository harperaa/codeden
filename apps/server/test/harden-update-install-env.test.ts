import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedCommand } from "@codeden/providers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installAppVersion } from "../src/services/updates/installer";

const fakeNpm: ResolvedCommand = {
  kind: "node-script",
  path: process.execPath,
  script: join(import.meta.dirname, "fixtures", "fake-npm-codeden", "npm-cli.mjs"),
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the update install keeps a person's restricting npm settings", () => {
  it("passes on min-release-age, before and allow-git, however they are spelled", async () => {
    const home = mkdtempSync(join(tmpdir(), "harden-update-env-"));
    for (const key of Object.keys(process.env)) {
      if (/^npm_config_/i.test(key)) vi.stubEnv(key, undefined);
    }
    const kept = {
      "NPM_CONFIG_MIN-RELEASE-AGE": "7",
      npm_config_before: "2026-01-01",
      npm_config_allow_git: "none",
    };
    for (const [key, value] of Object.entries(kept)) vi.stubEnv(key, value);
    // What upstream drops stays dropped, and so does the setting that would leave the terminal's
    // native module unbuilt.
    vi.stubEnv("npm_config_allow_scripts", "anything");
    vi.stubEnv("npm_config_prefix", "/somewhere/else");
    vi.stubEnv("npm_config_ignore_scripts", "true");

    await installAppVersion({ home, version: "0.2.0", npm: fakeNpm });
    const keys = JSON.parse(readFileSync(join(home, "app", "npm-env.json"), "utf8")) as string[];
    for (const key of Object.keys(kept)) expect(keys).toContain(key);
    for (const dropped of ["allow_scripts", "prefix", "ignore_scripts"]) {
      expect(keys).not.toContain(`npm_config_${dropped}`);
    }
  });
});
