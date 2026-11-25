import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactoryLimits } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitEnv } from "../src/services/dev-preview/base-checkout";
import type { Exec } from "../src/services/exec";
import { createPreviewEnv, type PreviewEnv, SETTINGS } from "./support/dev-preview-env";
import { commit, createRepos, isolatedGit, type Repos } from "./support/dev-preview-git";

/**
 * The PM thread's preview over the life of a project and of the app: who may start it, what
 * happens to its checkout when the preview goes, an unreachable remote. Real git, scripted
 * processes.
 */
let repos: Repos;
let env: PreviewEnv;
let gitCalls: { args: string[]; env: NodeJS.ProcessEnv | undefined }[];
const on = { ...SETTINGS, pmEnabled: true };

function setUp() {
  const recording: Exec = (command, args, opts) => {
    gitCalls.push({ args, env: opts?.env });
    return isolatedGit(command, args, opts);
  };
  env = createPreviewEnv({ exec: recording });
  env.projects.set("app", {
    ...env.addProject("app", { defaultBranch: "trunk" }),
    path: repos.repo,
  });
}
beforeEach(() => {
  repos = createRepos();
  gitCalls = [];
  setUp();
});
afterEach(async () => {
  await env.close();
  repos.close();
});

const state = () => env.service.baseState("app", false);
const checkout = () => env.procs.find((p) => p.spec.command === "run-dev")?.spec.cwd ?? "";
const tickAfter = async (ms: number) => {
  env.clock.now += ms;
  await env.service.tick();
  await env.service.idle();
};
const up = async () => {
  env.listening.add(43100);
  await env.service.tick();
};
const fetches = () => gitCalls.filter((c) => c.args.includes("fetch")).length;
const change = (over: Parameters<typeof Object.assign>[1]) => {
  const project = env.projects.get("app");
  if (project) env.projects.set("app", { ...project, ...over });
};

describe("who starts it", () => {
  it("a project with automatic merges waits for a person each time the app starts", async () => {
    change({ factoryLimits: FactoryLimits.parse({ autoMerge: true }) });
    // Confirming the settings is a person's start.
    await env.service.setProject("app", on);
    await env.service.idle();
    expect(env.running()).toHaveLength(1);
    await env.service.stop();

    const next = env.restart();
    next.start();
    await next.idle();
    env.clock.now += 91_000;
    await next.tick();
    await next.idle();
    expect(env.running()).toHaveLength(0);
    expect(fetches()).toBe(1);
    const waiting = next.baseState("app", false);
    expect(waiting).toMatchObject({ status: "stopped", enabled: true });
    expect(waiting.message).toMatch(/Automatic merges are on/);
    // The person's click starts it, and from then on it follows the branch as usual.
    await next.updateBase("app");
    expect(env.running()).toHaveLength(1);
    repos.pushToOrigin("index.html", "merged\n");
    env.listening.add(43100);
    await next.tick();
    env.clock.now += 91_000;
    await next.tick();
    await next.idle();
    expect(readFileSync(join(checkout(), "index.html"), "utf8")).toBe("merged\n");
    await next.stop();
  });

  it("without automatic merges it comes back by itself, and a session's preview never does", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    env.addSession("s1", "app");
    await env.service.startSession("s1");
    expect(env.running()).toHaveLength(2);
    await env.service.stop();

    const next = env.restart();
    next.start();
    await next.idle();
    env.listening.add(43100);
    for (let i = 0; i < 3; i++) {
      env.clock.now += 91_000;
      await next.tick();
      await next.idle();
    }
    expect(env.running().map((p) => p.spec.cwd)).toEqual([checkout()]);
    expect(next.sessionState("s1", false)).toMatchObject({ status: "off", enabled: false });
    await next.stop();
  });
});

describe("its own git commands", () => {
  it("run without the app's variables and without a hook's repository variables", async () => {
    process.env.CODEDEN_HOME = "/somewhere/private";
    process.env.GIT_DIR = "/a/hook/repo";
    try {
      expect(gitEnv()).toMatchObject({ CODEDEN_HOME: undefined, GIT_DIR: undefined });
      expect(Object.keys(gitEnv())).toEqual(expect.arrayContaining(["CODEDEN_HOME", "GIT_DIR"]));
      // Cleared before git runs, or GIT_DIR above would point every command at nothing.
      delete process.env.GIT_DIR;
      await env.service.setProject("app", on);
      await env.service.idle();
      expect(gitCalls.length).toBeGreaterThan(3);
      for (const call of gitCalls) {
        expect(call.env).toBeDefined();
        expect(call.env?.CODEDEN_HOME, call.args.join(" ")).toBeUndefined();
        expect("CODEDEN_HOME" in (call.env ?? {})).toBe(true);
      }
    } finally {
      delete process.env.CODEDEN_HOME;
      delete process.env.GIT_DIR;
    }
  });
});

describe("a remote that can't be reached", () => {
  it("says so, keeps the preview running and asks less and less often", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    await up();
    renameSync(repos.origin, `${repos.origin}.away`);
    await tickAfter(91_000);
    expect(state()).toMatchObject({ status: "running", base: { blocked: false } });
    expect(state().message).toMatch(/remote couldn't be reached/);
    const after = fetches();
    // Not again after 90 seconds: the wait doubles with every failure.
    await tickAfter(91_000);
    expect(fetches()).toBe(after);
    await tickAfter(91_000);
    expect(fetches()).toBe(after + 1);
    // Back again: the note goes, and the usual pace returns.
    renameSync(`${repos.origin}.away`, repos.origin);
    await env.service.updateBase("app");
    expect(state().message).toBeNull();
    const reached = fetches();
    await tickAfter(91_000);
    expect(fetches()).toBe(reached + 1);
  });
});

describe("when the preview goes", () => {
  it("takes the checkout away with installed dependencies, but keeps one that holds a person's ignored file", async () => {
    commit(repos.repo, ".gitignore", "node_modules/\n.env.local\n", "ignore");
    repos.pushToOrigin(".gitignore", "node_modules/\n.env.local\n");
    await env.service.setProject("app", on);
    await env.service.idle();
    const path = checkout();
    mkdirSync(join(path, "node_modules", "left-pad"), { recursive: true });
    writeFileSync(join(path, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
    writeFileSync(join(path, ".env.local"), "SECRET=1\n");
    const kept = await env.service.removeProject("app");
    expect(kept.notice).toMatch(/was kept: it holds ignored files.*\.env\.local/);
    expect(readFileSync(join(path, ".env.local"), "utf8")).toBe("SECRET=1\n");
    expect(env.running()).toHaveLength(0);

    // Without that file, only what installing makes again is there: it goes.
    await env.service.setProject("app", on);
    await env.service.idle();
    writeFileSync(join(path, ".env.local"), "");
    const { unlinkSync } = await import("node:fs");
    unlinkSync(join(path, ".env.local"));
    const gone = await env.service.removeProject("app");
    expect(gone.notice).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  it("an archived project loses its dev preview: settings and checkout", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    const path = checkout();
    change({ archivedAt: "2026-11-07T11:00:00.000Z" });
    await env.service.tick();
    await env.service.idle();
    expect(env.running()).toHaveLength(0);
    expect(env.store.config("app")).toBeNull();
    expect(existsSync(path)).toBe(false);
    // Restored later, it starts from nothing: a person sets the preview up again.
    change({ archivedAt: null });
    await tickAfter(91_000);
    expect(env.procs).toHaveLength(1);
    expect(env.service.project("app", false).config).toBeNull();
  });
});
