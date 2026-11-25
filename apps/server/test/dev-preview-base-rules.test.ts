import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncBaseCheckout } from "../src/services/dev-preview/base-checkout";
import type { Exec } from "../src/services/exec";
import { createPreviewEnv, type PreviewEnv, SETTINGS } from "./support/dev-preview-env";
import { commit, createRepos, git, isolatedGit, type Repos } from "./support/dev-preview-git";

/**
 * What the PM thread's preview must never do, against real git repositories: follow a branch
 * nobody confirmed, run a repository's hooks, touch the person's other worktrees, start after
 * Stop all or after the app closed.
 */
let repos: Repos;
let env: PreviewEnv;
const on = { ...SETTINGS, pmEnabled: true };

function setUp(exec: Exec = isolatedGit) {
  env = createPreviewEnv({ exec });
  env.projects.set("app", {
    ...env.addProject("app", { defaultBranch: "trunk" }),
    path: repos.repo,
  });
}
beforeEach(() => {
  repos = createRepos();
  setUp();
});
afterEach(async () => {
  await env.close();
  repos.close();
});

const state = () => env.service.baseState("app", false);
const up = async () => {
  env.listening.add(43100);
  await env.service.tick();
};
const tickAfter = async (ms: number) => {
  env.clock.now += ms;
  await env.service.tick();
  await env.service.idle();
};
const setBaseBranch = (defaultBranch: string) => {
  const project = env.projects.get("app");
  if (project) env.projects.set("app", { ...project, defaultBranch });
};

describe("the branch it follows is the one a person confirmed", () => {
  it("stops, and runs nothing from it, when someone else points the project at another branch", async () => {
    await env.service.setProject("app", { ...on, prepareCommand: "install-deps" });
    await env.service.idle();
    env.procs[0]?.exit(0);
    await new Promise((r) => setImmediate(r));
    await up();
    const checkout = env.procs[1]?.spec.cwd ?? "";
    const before = git(checkout, "rev-parse", "HEAD");
    // An agent pushed a branch on top of trunk, with a new lockfile so that prepare would run,
    // and the project's base branch was switched to it (the orchestrator's project tool, or
    // the project settings from another device).
    repos.pushToOrigin("pnpm-lock.yaml", "evil: true\n", "agent/takeover");
    setBaseBranch("agent/takeover");
    await tickAfter(91_000);
    expect(env.running()).toHaveLength(0);
    expect(env.procs).toHaveLength(2);
    expect(git(checkout, "rev-parse", "HEAD")).toBe(before);
    expect(existsSync(join(checkout, "pnpm-lock.yaml"))).toBe(false);
    expect(state()).toMatchObject({ status: "stopped", base: { branch: "trunk", blocked: true } });
    expect(state().message).toMatch(/base branch is now "agent\/takeover".*confirmed for "trunk"/);
    // Nothing brings it back but the person confirming again, on this computer.
    await tickAfter(91_000);
    await expect(env.service.updateBase("app")).resolves.toMatchObject({ status: "stopped" });
    expect(env.procs).toHaveLength(2);
    // Switched back, it carries on where it was.
    setBaseBranch("trunk");
    await tickAfter(91_000);
    expect(env.running()).toHaveLength(1);
  });

  it("follows the new branch once the person confirms the settings again", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    repos.pushToOrigin("index.html", "release\n", "release");
    setBaseBranch("release");
    await env.service.setProject("app", on);
    await env.service.idle();
    expect(env.service.project("app", false).config?.baseBranch).toBe("release");
    expect(readFileSync(join(env.procs.at(-1)?.spec.cwd ?? "", "index.html"), "utf8")).toBe(
      "release\n",
    );
    expect(state()).toMatchObject({
      status: "starting",
      base: { branch: "release", blocked: false },
    });
  });
});

describe("git in the person's repository", () => {
  it("runs no hook of the repository when it makes or moves the checkout", async () => {
    // Hooks in a tracked folder, as this repository has them: code from the branch.
    const marker = join(repos.root, "hook-ran");
    const hook = `#!/bin/sh\necho ran >> ${JSON.stringify(marker)}\n`;
    commit(repos.repo, "hooks/post-checkout", hook, "hooks");
    commit(repos.repo, "hooks/post-merge", hook, "hooks");
    chmodSync(join(repos.repo, "hooks/post-checkout"), 0o755);
    chmodSync(join(repos.repo, "hooks/post-merge"), 0o755);
    git(repos.repo, "add", "-A");
    git(repos.repo, "commit", "-q", "-m", "executable hooks");
    git(repos.repo, "push", "-q", "origin", "trunk");
    git(repos.repo, "config", "core.hooksPath", "hooks");
    const path = join(repos.root, "checkout");
    const sync = () => syncBaseCheckout(isolatedGit, { repo: repos.repo, path, branch: "trunk" });
    expect(await sync()).toMatchObject({ ok: true, moved: true });
    repos.pushToOrigin("index.html", "two\n");
    expect(await sync()).toMatchObject({ ok: true, moved: true });
    expect(existsSync(marker)).toBe(false);
    // The hooks are real: git runs them for the person's own checkout.
    git(repos.repo, "checkout", "-q", "-b", "other");
    expect(existsSync(marker)).toBe(true);
  });

  it("leaves the person's other worktrees registered, also one whose folder is away", async () => {
    const away = join(repos.root, "on-another-drive");
    git(repos.repo, "worktree", "add", "-q", "-b", "mine", away);
    rmSync(away, { recursive: true, force: true });
    const path = join(repos.root, "checkout");
    const sync = () => syncBaseCheckout(isolatedGit, { repo: repos.repo, path, branch: "trunk" });
    expect(await sync()).toMatchObject({ ok: true });
    expect(git(repos.repo, "worktree", "list", "--porcelain")).toContain(away);
    // Its own checkout, deleted by hand, is made again in place.
    rmSync(path, { recursive: true, force: true });
    expect(await sync()).toMatchObject({ ok: true, moved: true });
    expect(readFileSync(join(path, "index.html"), "utf8")).toBe("one\n");
    expect(git(repos.repo, "worktree", "list", "--porcelain")).toContain(away);
  });

  it("finds the branch in a clone that follows a single other branch", async () => {
    repos.pushToOrigin("index.html", "release\n", "release");
    git(repos.repo, "config", "remote.origin.fetch", "+refs/heads/trunk:refs/remotes/origin/trunk");
    const path = join(repos.root, "checkout");
    const result = await syncBaseCheckout(isolatedGit, {
      repo: repos.repo,
      path,
      branch: "release",
    });
    expect(result).toMatchObject({ ok: true });
    expect(readFileSync(join(path, "index.html"), "utf8")).toBe("release\n");
  });
});

describe("stopped means stopped", () => {
  it("Stop all holds the PM thread's preview until a person starts it again", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    await up();
    expect(await env.service.stopAll()).toEqual({ stopped: 1, failed: [] });
    repos.pushToOrigin("index.html", "two\n");
    await tickAfter(91_000);
    await tickAfter(91_000);
    expect(env.procs).toHaveLength(1);
    expect(state()).toMatchObject({ status: "stopped", enabled: true });
    expect(state().message).toMatch(/Stop all/);
    await env.service.updateBase("app");
    expect(env.running()).toHaveLength(1);
  });

  it("nothing starts after the app closed, even from a look at the branch still under way", async () => {
    await env.close();
    let release: () => void = () => {};
    const fetching = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    // The fetch hangs, as on a slow network, until the test lets it go.
    setUp(async (command, args, opts) => {
      if (args.includes("fetch")) {
        held = true;
        await fetching;
      }
      return isolatedGit(command, args, opts);
    });
    env.store.confirm("app", on, new Date(env.clock.now), "trunk");
    env.service.start();
    while (!held) await new Promise((r) => setImmediate(r));
    const closing = env.service.stop();
    release();
    await closing;
    await env.service.idle();
    expect(env.procs).toHaveLength(0);
  });
});
