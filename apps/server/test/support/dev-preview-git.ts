import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Exec, runTool } from "../../src/services/exec";

/**
 * Real git repositories in a temp folder for the PM thread's preview: an "origin", and the
 * project's clone of it, on a base branch called `trunk` (not main, not harden: the branch is
 * the project's own setting).
 */
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)),
);
// The suites must behave the same when they are run from a git hook.
for (const key of Object.keys(process.env)) if (/^GIT_/i.test(key)) delete process.env[key];

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...GIT_ENV,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  }).trim();
}

export function commit(cwd: string, file: string, content: string, message: string): string {
  mkdirSync(join(cwd, file, ".."), { recursive: true });
  writeFileSync(join(cwd, file), content);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

export interface Repos {
  root: string;
  origin: string;
  /** The project's own folder. */
  repo: string;
  /** A new commit lands on a branch at the remote, as a merged pull request would. */
  pushToOrigin(file: string, content: string, branch?: string): string;
  close(): void;
}

export function createRepos(): Repos {
  const root = mkdtempSync(join(tmpdir(), "dev-preview-base-"));
  const origin = join(root, "origin.git");
  const repo = join(root, "project");
  mkdirSync(repo);
  git(root, "init", "-q", "--bare", "-b", "trunk", origin);
  git(repo, "init", "-q", "-b", "trunk");
  commit(repo, "index.html", "one\n", "init");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "-u", "origin", "trunk");
  return {
    root,
    origin,
    repo,
    pushToOrigin(file, content, branch = "trunk") {
      const work = join(root, `work-${Math.random().toString(36).slice(2)}`);
      git(root, "clone", "-q", "-b", "trunk", origin, work);
      if (branch !== "trunk") git(work, "checkout", "-q", "-B", branch);
      const sha = commit(work, file, content, `change ${file}`);
      git(work, "push", "-q", "origin", branch);
      return sha;
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * The app's own git, as the code under test runs it, but blind to the developer's global and
 * system git configuration (signing, hooks, default branch), which no test should depend on.
 */
export const isolatedGit: Exec = (command, args, opts) =>
  runTool(command, args, {
    ...opts,
    env: { ...opts?.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
