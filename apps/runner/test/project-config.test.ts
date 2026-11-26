/**
 * `readProjectConfig`: `.codeden/project.json` is a file the repository controls, so a missing,
 * broken or wrong one must come back as "no config" (with the reason), never as a throw or as
 * half-read settings.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROJECT_CONFIG_PATH, readProjectConfig } from "../src/workspace/project-config";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-project-config-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeConfig(text: string): void {
  mkdirSync(join(dir, ".codeden"), { recursive: true });
  writeFileSync(join(dir, PROJECT_CONFIG_PATH), text);
}

describe("readProjectConfig", () => {
  it("gives no config and no error for a checkout without the file", async () => {
    expect(await readProjectConfig(dir)).toEqual({ config: null });
    // Not even when the folder is there, or the checkout isn't.
    mkdirSync(join(dir, ".codeden"));
    expect(await readProjectConfig(dir)).toEqual({ config: null });
    expect(await readProjectConfig(join(dir, "missing"))).toEqual({ config: null });
  });

  it("reports a file that is not JSON, naming the path first", async () => {
    for (const text of ["{ setup: [", "", "// just a comment\n"]) {
      writeConfig(text);
      const read = await readProjectConfig(dir);
      expect(read.config).toBeNull();
      expect(read.error).toMatch(/^\.codeden\/project\.json: ./);
    }
  });

  it("reports a file that fails the schema, naming the path first", async () => {
    for (const value of [
      { setup: "pnpm install" },
      { setup: [""] },
      { setup: [1] },
      { devServer: { port: 3000 } },
      { checks: [{ timeoutSec: 5 }] },
      [],
      null,
      "pnpm install",
    ]) {
      writeConfig(JSON.stringify(value));
      const read = await readProjectConfig(dir);
      expect(read.config).toBeNull();
      expect(read.error).toMatch(/^\.codeden\/project\.json: ./);
    }
  });

  it("gives a valid file back as written, with the defaults filled in", async () => {
    const config = {
      setup: ["pnpm install", "pnpm build"],
      devServer: "pnpm dev",
      checks: ["pnpm typecheck", { command: "pnpm test", timeoutSec: 600 }],
    };
    writeConfig(JSON.stringify(config, null, 2));
    expect(await readProjectConfig(dir)).toEqual({ config });

    writeConfig("{}");
    expect(await readProjectConfig(dir)).toEqual({ config: { setup: [], checks: [] } });
  });
});
