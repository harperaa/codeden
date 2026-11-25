import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Exec } from "../exec";

/**
 * The checkout the PM thread's preview runs from: a worktree of the project, managed by the
 * app, at the tip of the project's base branch.
 *
 * It only ever moves forward. Every update is `git merge --ff-only` to the branch's tip; when
 * that isn't a fast-forward (someone committed in the checkout, or the branch was rewritten)
 * or git refuses because of local changes, the update stops with a message and the checkout is
 * left exactly as it was. Nothing here resets, checks out over, cleans or prunes anything.
 *
 * Git's hooks are switched off for every command here, the fetch included. A repository
 * whose hooks folder is a tracked one would otherwise run its code (a `post-checkout`,
 * `post-merge` or `reference-transaction` script) that nobody confirmed as a command.
 */
const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"];

/**
 * The environment of the app's git commands here: the person's own, without the app's
 * variables and without a hook's repository variables, as a preview's processes get it. Git
 * starts programs of its own (credential helpers, ssh, filters); they get no more than that.
 */
export function gitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(base)) {
    if (/^CODEDEN_/i.test(key) || /^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR)$/.test(key)) {
      // `undefined` takes the variable out of what the exec helper passes on.
      env[key] = undefined;
    }
  }
  env.ELECTRON_RUN_AS_NODE = undefined;
  return env;
}

/** Folders and files that are made again by installing or building: safe to take away. */
const REBUILDABLE = new Set([
  "node_modules",
  ".pnpm-store",
  ".yarn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vite",
  ".cache",
  ".parcel-cache",
  "coverage",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".gradle",
  ".DS_Store",
]);

function rebuildable(path: string): boolean {
  const parts = path.replace(/\/$/, "").split("/");
  return (
    parts.some((part) => REBUILDABLE.has(part)) ||
    /\.(?:tsbuildinfo|log|pyc)$/.test(parts[parts.length - 1] ?? "")
  );
}

export type BaseSync =
  | {
      ok: true;
      /** The commit now checked out. */
      commit: string;
      /** The checkout was created or moved to a newer commit by this call. */
      moved: boolean;
      /** Set when the remote couldn't be reached: the tip is the last one known. */
      note: string | null;
    }
  | { ok: false; message: string };

export interface BaseCheckout {
  /** The project's own folder. */
  repo: string;
  /** Where the checkout lives, inside the app's home. */
  path: string;
  /** The project's base branch. */
  branch: string;
}

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? ""
  );
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Bring the checkout to the base branch's tip, creating it first if it isn't there. */
export async function syncBaseCheckout(exec: Exec, base: BaseCheckout): Promise<BaseSync> {
  const { repo, path, branch } = base;
  if (!BRANCH.test(branch) || branch.includes("..")) {
    return { ok: false, message: `"${branch}" isn't a branch name the preview can follow.` };
  }
  const env = gitEnv();
  const git = (cwd: string, args: string[], timeoutMs = 30_000) =>
    exec("git", [...NO_HOOKS, "-C", cwd, ...args], { timeoutMs, env });

  // The tip "as known from the remote": fetched when there is one, the local branch otherwise.
  const hasOrigin = (await git(repo, ["remote", "get-url", "origin"])).code === 0;
  let note: string | null = null;
  if (hasOrigin) {
    // The tracking ref by name: a clone that follows a single branch has no rule for others.
    const refspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
    const fetched = await git(repo, ["fetch", "--no-tags", "origin", refspec], 120_000);
    if (fetched.code !== 0) note = "The remote couldn't be reached; this is the last tip known.";
  }
  const ref = hasOrigin ? `refs/remotes/origin/${branch}` : `refs/heads/${branch}`;
  const tip = await git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  const target = tip.code === 0 ? tip.stdout.trim() : "";
  if (!target) {
    return {
      ok: false,
      message: hasOrigin
        ? `The base branch "${branch}" wasn't found on the remote.`
        : `The base branch "${branch}" doesn't exist in the project.`,
    };
  }

  if (!existsSync(path)) {
    const add = (extra: string[]) =>
      git(repo, ["worktree", "add", ...extra, "--detach", path, target], 300_000);
    let added = await add([]);
    // The folder was deleted by hand and git still has its record. `--force` reuses that one
    // record; the project's other worktrees (one on a drive that isn't mounted) are untouched,
    // which `git worktree prune` would not leave them.
    if (added.code !== 0 && /already registered|missing but/i.test(added.stderr)) {
      added = await add(["--force"]);
    }
    if (added.code !== 0) {
      return {
        ok: false,
        message: `The preview checkout couldn't be created: ${firstLine(added.stderr)}`,
      };
    }
    return { ok: true, commit: target, moved: true, note };
  }

  // A folder is there. It must be this project's worktree, or it is left alone.
  const [ours, theirs] = await Promise.all([
    git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ]);
  if (
    ours.code !== 0 ||
    theirs.code !== 0 ||
    real(ours.stdout.trim()) !== real(theirs.stdout.trim())
  ) {
    return {
      ok: false,
      message: `${path} exists and isn't this project's preview checkout. Nothing was changed; move it away to let the preview make a new one.`,
    };
  }
  const head = await git(path, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  const current = head.code === 0 ? head.stdout.trim() : "";
  if (!current) {
    return { ok: false, message: `The preview checkout at ${path} has no commit checked out.` };
  }
  if (current === target) return { ok: true, commit: current, moved: false, note };

  const forward = await git(path, ["merge-base", "--is-ancestor", current, target]);
  if (forward.code !== 0) {
    return {
      ok: false,
      message: `The preview checkout can't be fast-forwarded to ${branch}: it has commits the branch doesn't have, or the branch was rewritten. Nothing was changed. Look at ${path}, or move it away to let the preview make a new one.`,
    };
  }
  const merged = await git(path, ["merge", "--ff-only", target], 300_000);
  if (merged.code !== 0) {
    return {
      ok: false,
      message: `The preview checkout couldn't be fast-forwarded to ${branch}: ${firstLine(merged.stderr) || "git refused"}. Nothing was changed; local changes in ${path} are probably in the way.`,
    };
  }
  return { ok: true, commit: target, moved: true, note };
}

/**
 * Take the checkout away when a project's preview is removed. Returns null when it is gone,
 * or why it was kept.
 *
 * Plain `git worktree remove`, never forced: git refuses when the checkout holds changes or
 * untracked files. What git ignores would go with it, so that is looked at first: installed
 * dependencies and build output are fine to lose, but any other ignored file (an `.env.local`
 * someone put there) keeps the checkout, and the answer names it.
 */
export async function removeBaseCheckout(
  exec: Exec,
  base: Omit<BaseCheckout, "branch">,
): Promise<string | null> {
  if (!existsSync(base.path)) return null;
  const env = gitEnv();
  const status = await exec(
    "git",
    [...NO_HOOKS, "-C", base.path, "status", "--porcelain", "--ignored", "--untracked-files=all"],
    { timeoutMs: 60_000, env },
  );
  if (status.code !== 0) {
    return `The preview's checkout at ${base.path} was kept: git couldn't read its state.`;
  }
  const lines = status.stdout.split("\n").filter(Boolean);
  const changed = lines.filter((line) => !line.startsWith("!! "));
  if (changed.length > 0) {
    return `The preview's checkout at ${base.path} was kept: it has changes or files git doesn't know.`;
  }
  const own = lines.map((line) => line.slice(3)).filter((path) => !rebuildable(path));
  if (own.length > 0) {
    const names = own.slice(0, 3).join(", ");
    return `The preview's checkout at ${base.path} was kept: it holds ignored files that can't be made again (${names}${own.length > 3 ? ", …" : ""}).`;
  }
  const removed = await exec(
    "git",
    [...NO_HOOKS, "-C", base.repo, "worktree", "remove", base.path],
    {
      timeoutMs: 120_000,
      env,
    },
  );
  return removed.code === 0
    ? null
    : `The preview's checkout at ${base.path} was kept: git wouldn't remove it.`;
}
