import type { SandboxRef, SandboxState, UnpushedWork } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import {
  type CloneCheck,
  checkClone,
  deletedMessage,
  keptOutcome,
} from "../src/execution/clone-check";
import { RunnerCommandError } from "../src/runner/client";
import type { RunnerPort } from "../src/services/runner-port";

/**
 * The check before a sandbox's container and volume are deleted (#337): its clone is the only
 * copy of commits that were never pushed, so a wrong "clean" deletes work. `sandbox-archive.
 * test.ts` covers the archive as a whole; this covers each way the check itself can end, with a
 * scripted runner and backend.
 */

const REF: SandboxRef = { backend: "docker", container: "codeden-s1", volume: "codeden-s1-data" };
const CWD = "/home/runner/clones/demo";
const NOTHING: UnpushedWork = { current: "main", uncommitted: 0, branches: [], stashes: 0 };
const WORK: UnpushedWork = {
  current: "codeden/fix",
  uncommitted: 2,
  branches: [{ name: "codeden/fix", commits: 3 }],
  stashes: 1,
};

interface Script {
  connected?: boolean;
  /** What `waitForConnection` resolves to. */
  answers?: boolean;
  /** The runner's name in errors; absent for the home runner. */
  name?: string;
  /** What `git.unpushed` returns, or the error it fails with. */
  unpushed?: UnpushedWork | Error;
  /** The container's state, or the error reading it fails with. */
  state?: SandboxState | null | Error;
  /** The error starting the container fails with. */
  startFails?: Error;
}

function scripted(script: Script) {
  const calls: string[] = [];
  const runner = {
    isConnected: () => script.connected ?? true,
    waitForConnection: async (timeoutMs: number) => {
      calls.push(`wait ${timeoutMs}`);
      return script.answers ?? true;
    },
    request: async (command: { name: string; cwd: string }, timeoutMs?: number) => {
      calls.push(`${command.name} ${command.cwd} ${timeoutMs}`);
      const result = script.unpushed ?? NOTHING;
      if (result instanceof Error) throw result;
      return result;
    },
    ...(script.name ? { describe: () => script.name as string } : {}),
  } as unknown as RunnerPort;
  const docker = {
    state: async (ref: SandboxRef) => {
      calls.push(`state ${ref.container}`);
      if (script.state instanceof Error) throw script.state;
      return script.state === undefined ? "running" : script.state;
    },
    start: async (ref: SandboxRef) => {
      calls.push(`start ${ref.container}`);
      if (script.startFails) throw script.startFails;
    },
  };
  const check = (wakeMs = 0) => checkClone({ runner, docker, ref: REF, cwd: CWD, wakeMs });
  return { check, calls };
}

describe("checkClone", () => {
  it("asks a connected runner about the session's clone, without touching the container", async () => {
    const clean = scripted({ unpushed: NOTHING });
    expect(await clean.check(5_000)).toEqual({ kind: "clean" });
    expect(clean.calls).toEqual([`git.unpushed ${CWD} 30000`]);

    const work = scripted({ unpushed: WORK });
    expect(await work.check()).toEqual({ kind: "work", work: WORK });
  });

  it("reports each kind of work on its own: a stash, an uncommitted file, an unpushed commit", async () => {
    for (const only of [
      { ...NOTHING, stashes: 1 },
      { ...NOTHING, uncommitted: 1 },
      { ...NOTHING, branches: [{ name: "HEAD", commits: 1 }] },
    ]) {
      expect(await scripted({ unpushed: only }).check()).toEqual({ kind: "work", work: only });
    }
  });

  it("a clone that was never made is clean; any other failure leaves it unknown", async () => {
    const missing = scripted({ unpushed: new RunnerCommandError("cwd_missing", "No such folder") });
    expect(await missing.check()).toEqual({ kind: "clean" });

    const failed = scripted({
      unpushed: new RunnerCommandError("git_failed", "fatal: not a repo"),
    });
    expect(await failed.check()).toEqual({
      kind: "unknown",
      reason: "Its clone couldn't be checked: fatal: not a repo",
    });

    // An error without a code (a timeout, a dropped connection) is never read as "no clone".
    const dropped = scripted({ unpushed: new Error("Runner request timed out") });
    expect(await dropped.check()).toMatchObject({ kind: "unknown" });
  });

  it("doesn't wake a runner that isn't connected when asked not to wait", async () => {
    const named = scripted({ connected: false, name: "Runner rn-1 (docker)" });
    expect(await named.check(0)).toEqual({
      kind: "unknown",
      reason: "Runner rn-1 (docker) is not connected, so its clone couldn't be checked",
    });
    expect(named.calls).toEqual([]);

    const unnamed = scripted({ connected: false });
    expect(await unnamed.check(0)).toEqual({
      kind: "unknown",
      reason: "The sandbox's runner is not connected, so its clone couldn't be checked",
    });
  });

  it("starts a stopped container, waits for its runner, then asks", async () => {
    const stopped = scripted({ connected: false, state: "exited", unpushed: WORK });
    expect(await stopped.check(20_000)).toEqual({ kind: "work", work: WORK });
    expect(stopped.calls).toEqual([
      "state codeden-s1",
      "start codeden-s1",
      "wait 20000",
      `git.unpushed ${CWD} 30000`,
    ]);
  });

  it("only waits for the runner of a container that is running already", async () => {
    const running = scripted({ connected: false, state: "running" });
    expect(await running.check(20_000)).toEqual({ kind: "clean" });
    expect(running.calls).toEqual(["state codeden-s1", "wait 20000", `git.unpushed ${CWD} 30000`]);
  });

  it("is unknown, never clean, when the container is gone, can't be started or doesn't answer", async () => {
    const gone = scripted({ connected: false, state: null });
    expect(await gone.check(20_000)).toEqual({
      kind: "unknown",
      reason: "The container codeden-s1 is gone, so its clone couldn't be checked",
    });
    expect(gone.calls).toEqual(["state codeden-s1"]);

    const noDocker = scripted({ connected: false, state: new Error("docker: not found") });
    expect(await noDocker.check(20_000)).toEqual({
      kind: "unknown",
      reason: "The container codeden-s1 couldn't be started to check its clone: docker: not found",
    });

    const noStart = scripted({
      connected: false,
      state: "exited",
      startFails: new Error("port is already allocated"),
    });
    expect(await noStart.check(20_000)).toEqual({
      kind: "unknown",
      reason:
        "The container codeden-s1 couldn't be started to check its clone: port is already allocated",
    });
    expect(noStart.calls).toEqual(["state codeden-s1", "start codeden-s1"]);

    const silent = scripted({ connected: false, answers: false, name: "Runner rn-1 (docker)" });
    expect(await silent.check(20_400)).toEqual({
      kind: "unknown",
      reason: "Runner rn-1 (docker) didn't answer within 20 s, so its clone couldn't be checked",
    });
    // Nothing was asked of a runner that never connected.
    expect(silent.calls).toEqual(["state codeden-s1", "wait 20400"]);
  });
});

describe("the outcome of a removal the check decided on", () => {
  const clean: CloneCheck = { kind: "clean" };
  const work: CloneCheck = { kind: "work", work: WORK };
  const unknown: CloneCheck = { kind: "unknown", reason: "The container codeden-s1 is gone" };

  it("keeps the container while its clone has work, naming all of it", () => {
    expect(keptOutcome(work)).toEqual({
      status: "kept_changes",
      message:
        "The container's clone has 3 unpushed commits on codeden/fix, uncommitted changes in 2 files and 1 stash, so the container and its volume were kept",
      unpushed: WORK,
    });
  });

  it("keeps the container when the clone couldn't be checked, as a failure with the reason", () => {
    expect(keptOutcome(unknown)).toEqual({
      status: "failed",
      message: "The container codeden-s1 is gone. The container and its volume were kept.",
    });
  });

  it("removes only a clean clone without being forced", () => {
    expect(keptOutcome(clean)).toBeNull();
    expect(deletedMessage(clean)).toBeNull();
  });

  it("a forced removal says what was deleted, or that it couldn't know", () => {
    expect(deletedMessage(work)).toBe(
      "Deleted with the container: 3 unpushed commits on codeden/fix, uncommitted changes in 2 files and 1 stash",
    );
    expect(deletedMessage(unknown)).toBe(
      "Its clone couldn't be checked first, so anything it hadn't pushed was deleted with the container",
    );
  });
});
