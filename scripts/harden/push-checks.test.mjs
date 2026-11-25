// The pre-push hook and the two check scripts, run as written in a scratch repository with a
// stub `pnpm` that records how it was called. No real typecheck, lint or test runs here.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASE_ENV, repository } from "./test-support/scratch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ["hooks/pre-push", "push-checks.sh", "local-checks.sh", "checks-env.sh"];
const ZERO = "0".repeat(40);

/** A stub program: appends its name, arguments, PATH and git's variables to `log`. */
function stub(file, log) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `#!/usr/bin/env bash
echo "$(basename "$0") $* | PATH=$PATH | GIT_DIR=\${GIT_DIR:-} GIT_INDEX_FILE=\${GIT_INDEX_FILE:-}" >> "${log}"
if [ -f "${log}.fail" ] && grep -qx "$1" "${log}.fail"; then exit 1; fi
exit 0
`,
  );
  chmodSync(file, 0o755);
}

/**
 * A repository on a work branch with the scripts committed, `origin/harden` at its first
 * commit, and stub tools. `toolsOnPath: false` leaves them only where the scripts search.
 */
function world({ toolsOnPath = true } = {}) {
  const repo = repository("codeharden-push-checks-");
  const home = mkdtempSync(join(tmpdir(), "codeharden-push-home-"));
  const log = join(home, "calls.log");
  for (const file of FILES) {
    mkdirSync(dirname(join(repo.dir, "scripts/harden", file)), { recursive: true });
    copyFileSync(join(HERE, file), join(repo.dir, "scripts/harden", file));
    chmodSync(join(repo.dir, "scripts/harden", file), 0o755);
  }
  repo.git("add", ".");
  repo.git("commit", "--quiet", "-m", "scripts");
  repo.git("update-ref", "refs/remotes/origin/harden", "HEAD");
  repo.git("checkout", "--quiet", "-b", "work");
  repo.commit("code.ts", "code");

  const toolsDir = toolsOnPath ? join(home, "bin") : join(home, ".nvm/versions/node/v1.0.0/bin");
  for (const tool of ["node", "pnpm", "codex"]) stub(join(toolsDir, tool), log);
  const system = "/usr/bin:/bin:/usr/sbin:/sbin";
  const gitDir = dirname(spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim());
  const env = {
    ...BASE_ENV,
    HOME: home,
    PATH: [...(toolsOnPath ? [toolsDir] : []), gitDir, system].join(delimiter),
  };
  const run = (script, args = [], { input = "", extraEnv = {} } = {}) => {
    const result = spawnSync(join(repo.dir, "scripts/harden", script), args, {
      cwd: repo.dir,
      encoding: "utf8",
      input,
      env: { ...env, ...extraEnv },
    });
    return { code: result.status, text: `${result.stdout}${result.stderr}` };
  };
  /** The hook as git runs it: its own variables set, the refs to push on stdin. */
  const push = (remoteRef, sha = repo.git("rev-parse", "HEAD")) =>
    run("hooks/pre-push", ["origin", "url"], {
      input: `refs/heads/work ${sha} ${remoteRef} ${ZERO}\n`,
      extraEnv: { GIT_DIR: join(repo.dir, ".git"), GIT_INDEX_FILE: join(repo.dir, ".git/index") },
    });
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  const commands = () => calls().map((line) => line.split(" | ")[0]);
  const failOn = (command) => writeFileSync(`${log}.fail`, `${command}\n`);
  return { repo, run, push, calls, commands, failOn, toolsDir };
}

describe("the pre-push hook", () => {
  it("runs typecheck and lint, never the tests, and remembers the pass for that tree", () => {
    const w = world();
    const first = w.push("refs/heads/work");
    expect(first.code, first.text).toBe(0);
    expect(w.commands()).toEqual(["pnpm typecheck", "pnpm lint"]);

    expect(w.push("refs/heads/work").code).toBe(0);
    expect(w.commands()).toHaveLength(2);
    expect(w.run("push-checks.sh", ["--status"]).code).toBe(0);

    w.repo.commit("more.ts", "more");
    expect(w.run("push-checks.sh", ["--status"]).code).toBe(1);
    expect(w.push("refs/heads/work").code).toBe(0);
    expect(w.commands()).toEqual(["pnpm typecheck", "pnpm lint", "pnpm typecheck", "pnpm lint"]);
    expect(w.commands().join("\n")).not.toContain("test");
  });

  it("keeps git's own hook variables away from what it runs", () => {
    const w = world();
    expect(w.push("refs/heads/work").code).toBe(0);
    expect(w.calls()).toHaveLength(2);
    for (const call of w.calls()) expect(call).toMatch(/GIT_DIR= GIT_INDEX_FILE=$/);
  });

  it("refuses the push when a check fails, and doesn't remember it", () => {
    const w = world();
    w.failOn("lint");
    const result = w.push("refs/heads/work");
    expect(result.code).toBe(1);
    expect(result.text).toContain("pnpm lint FAILED");
    expect(w.run("push-checks.sh", ["--status"]).code).toBe(1);

    w.failOn("typecheck");
    expect(w.push("refs/heads/work").code).toBe(1);
    expect(w.commands()).toEqual(["pnpm typecheck", "pnpm lint", "pnpm typecheck"]);
  });

  it.each([
    "refs/tags/v2026.0105.0518",
    "refs/heads/harden",
    "refs/heads/main",
    "refs/heads/mirror",
  ])("checks nothing for a push to %s", (remoteRef) => {
    const w = world();
    expect(w.push(remoteRef).code).toBe(0);
    expect(w.calls()).toEqual([]);
  });

  it("checks nothing for a deletion, a documentation-only branch or a commit that isn't checked out", () => {
    const w = world();
    expect(w.push("refs/heads/work", ZERO).code).toBe(0);

    const code = w.repo.git("rev-parse", "HEAD");
    w.repo.git("checkout", "--quiet", "-b", "docs-only", "refs/remotes/origin/harden");
    mkdirSync(join(w.repo.dir, "docs"));
    w.repo.commit("docs/guide.md", "guide");
    w.repo.commit("README.md", "readme");
    expect(w.push("refs/heads/docs-only").code).toBe(0);

    const other = w.push("refs/heads/work", code);
    expect(other.code).toBe(0);
    expect(other.text).toContain("not the checked-out commit");
    expect(w.calls()).toEqual([]);
  });

  it("checks the files as they are with uncommitted changes, without remembering", () => {
    const w = world();
    writeFileSync(join(w.repo.dir, "code.ts"), "edited\n");
    const result = w.push("refs/heads/work");
    expect(result.code).toBe(0);
    expect(result.text).toContain("uncommitted changes");
    expect(w.commands()).toEqual(["pnpm typecheck", "pnpm lint"]);
    expect(w.run("push-checks.sh", ["--status"]).code).toBe(1);
  });

  it("finds node and pnpm outside PATH without adding what lives beside them", () => {
    const w = world({ toolsOnPath: false });
    const result = w.push("refs/heads/work");
    expect(result.code, result.text).toBe(0);
    expect(w.commands()).toEqual(["pnpm typecheck", "pnpm lint"]);
    const path = /\| PATH=(.*?) \|/.exec(w.calls()[0])[1].split(delimiter);
    expect(path).not.toContain(w.toolsDir);
    expect(path[0]).toBe(join(w.repo.dir, ".git/harden-hook-bin"));
    expect(existsSync(join(path[0], "pnpm"))).toBe(true);
    expect(existsSync(join(path[0], "codex"))).toBe(false);
  });
});

describe("local-checks.sh, the manual full run", () => {
  it("runs the whole suite only when someone runs it, and remembers the pass", () => {
    const w = world();
    expect(w.run("local-checks.sh", ["--status"]).code).toBe(1);
    const first = w.run("local-checks.sh");
    expect(first.code, first.text).toBe(0);
    expect(w.commands()).toEqual(["pnpm test"]);
    expect(w.run("local-checks.sh").code).toBe(0);
    expect(w.commands()).toHaveLength(1);
    expect(w.run("local-checks.sh", ["--status"]).code).toBe(0);
    // A full pass says nothing about the push checks, and the hook never starts the suite.
    expect(w.push("refs/heads/work").code).toBe(0);
    expect(w.commands()).toEqual(["pnpm test", "pnpm typecheck", "pnpm lint"]);
  });

  it("refuses uncommitted changes and reports a failure", () => {
    const w = world();
    w.failOn("test");
    const failed = w.run("local-checks.sh");
    expect(failed.code).toBe(1);
    expect(failed.text).toContain("FAILED");
    expect(w.run("local-checks.sh", ["--status"]).code).toBe(1);

    writeFileSync(join(w.repo.dir, "code.ts"), "edited\n");
    expect(w.run("local-checks.sh").code).toBe(1);
    expect(w.commands()).toEqual(["pnpm test"]);
  });

  it("nothing in the hook or the push checks names it or the test command", () => {
    for (const file of ["hooks/pre-push", "push-checks.sh"]) {
      const code = readFileSync(join(HERE, file), "utf8")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .join("\n");
      expect(code).not.toMatch(/local-checks|pnpm test|\btest\b/);
    }
  });
});
