import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type LeftoverOps,
  leftoversOf,
  RunningRegistry,
} from "../src/services/dev-preview/leftovers";
import { PortAllocator } from "../src/services/dev-preview/ports";
import { type ProcessOps, shellInvocation, stopFamily } from "../src/services/dev-preview/process";
import {
  bootTimeMs,
  familyOf,
  type ProcessRow,
  parseProcessTable,
} from "../src/services/dev-preview/process-table";

/**
 * Which processes a preview may end, decided over process tables written out here. Nothing is
 * started and nothing is signalled: the system is scripted.
 */
const T9 = "Sat Nov  7 09:00:00 2026";
const T10 = "Sat Nov  7 10:00:00 2026";
const T11 = "Sat Nov  7 11:00:00 2026";
const row = (pid: number, ppid: number, pgid: number, started = T10): ProcessRow => ({
  pid,
  ppid,
  pgid,
  started,
});
const pids = (rows: ProcessRow[]) => rows.map((r) => r.pid).sort((a, b) => a - b);

/** The app (1000), a preview's shell (700) with its dev server (701) and a helper that left
 * the group (702), and other people's processes. */
const TABLE = [
  row(1, 0, 1, T9),
  row(1000, 1, 1000, T9),
  row(700, 1000, 700),
  row(701, 700, 700),
  row(702, 701, 702),
  row(800, 1, 800),
  row(801, 800, 800),
];
const leader = { pid: 700, started: T10 };

describe("reading the process table", () => {
  it("takes pid, parent, group and start time from each line", () => {
    const text =
      "    1     0     1 Sat Nov  7 09:00:00 2026\n  700  1000   700 Sat Nov  7 10:00:00 2026    \n\nbad line\n";
    expect(parseProcessTable(text)).toEqual([row(1, 0, 1, T9), row(700, 1000, 700)]);
  });

  it("works out when the computer started", () => {
    expect(bootTimeMs(1_000_000, 100)).toBe(900_000);
  });
});

describe("what belongs to a preview", () => {
  it("its leader, the leader's group and everything they started; never the app or strangers", () => {
    expect(pids(familyOf(TABLE, leader, 1000))).toEqual([700, 701, 702]);
  });

  it("nothing when the id now names another process", () => {
    // 700 was handed to a stranger, which leads a group of its own with children.
    const reused = [row(700, 1, 700, T11), row(705, 700, 700, T11), row(800, 1, 800)];
    expect(familyOf(reused, leader)).toEqual([]);
    // The same when the stranger sits in someone else's group and the old group lives on.
    const inside = [row(700, 800, 800, T11), row(701, 1, 700), row(800, 1, 800)];
    expect(familyOf(inside, leader)).toEqual([]);
    expect(familyOf(inside, { ...leader, endedAtMs: Date.parse(T10) + 60_000 })).toEqual([]);
  });

  it("nothing when the start time was never read", () => {
    expect(familyOf(TABLE, { pid: 700, started: null })).toEqual([]);
  });

  it("the group of a leader the app saw end, when every member started before that", () => {
    const orphans = [row(701, 1, 700), row(702, 701, 702), row(800, 1, 800)];
    const ended = Date.parse(T10) + 5_000;
    expect(pids(familyOf(orphans, { ...leader, endedAtMs: ended }))).toEqual([701, 702]);
    // A member that started after the leader ended means the group isn't the old one.
    const later = [row(701, 1, 700, T11), row(709, 1, 700)];
    expect(familyOf(later, { ...leader, endedAtMs: ended })).toEqual([]);
    // And without having seen the leader end, a leaderless group proves nothing.
    expect(familyOf(orphans, leader)).toEqual([]);
  });

  it("never the init process or an id that can't be a leader's", () => {
    expect(familyOf(TABLE, { pid: 1, started: T9 })).toEqual([]);
    expect(familyOf(TABLE, { pid: 0, started: T9 })).toEqual([]);
  });
});

describe("what a crash left behind", () => {
  const booted = Date.parse(T9);
  const record = {
    key: "session:s1",
    pid: 700,
    started: T10,
    spawnedAt: Date.parse(T10),
    cwd: "/w",
  };

  it("the recorded process, its group and what they started", () => {
    expect(pids(leftoversOf(record, TABLE, booted))).toEqual([700, 701, 702]);
  });

  it("nothing from before the computer last started, even when an id and time seem to match", () => {
    expect(leftoversOf(record, TABLE, Date.parse(T11))).toEqual([]);
  });

  it("nothing when the id went to another process, or the leader is gone", () => {
    expect(leftoversOf({ ...record, started: T9 }, TABLE, booted)).toEqual([]);
    expect(leftoversOf(record, [row(701, 1, 700), row(800, 1, 800)], booted)).toEqual([]);
    expect(leftoversOf({ ...record, started: null }, TABLE, booted)).toEqual([]);
  });

  describe("on the next start", () => {
    let dir: string;
    let killed: number[];
    let ops: LeftoverOps;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "dev-preview-left-"));
      killed = [];
      ops = { table: () => TABLE, bootedAtMs: () => booted, kill: (pid) => killed.push(pid) };
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));
    const file = () => join(dir, "running.json");

    it("ends exactly the proven leftovers and starts with an empty list", () => {
      const before = new RunningRegistry(file(), ops, () => Date.parse(T10));
      before.add("session:s1", { pid: 700, started: T10 }, "/w");
      // A second record whose id now belongs to someone else (800 started at T10, not T9).
      before.add("base:app", { pid: 800, started: T9 }, "/b");
      expect(JSON.parse(readFileSync(file(), "utf8"))).toHaveLength(2);

      expect(new RunningRegistry(file(), ops).cleanUp()).toEqual(["session:s1"]);
      expect(killed.sort()).toEqual([700, 701, 702]);
      expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual([]);
      killed.length = 0;
      expect(new RunningRegistry(file(), ops).cleanUp()).toEqual([]);
      expect(killed).toEqual([]);
    });

    it("signals nothing after a reboot, for a file it can't read, or a record of an older shape", () => {
      const before = new RunningRegistry(file(), ops, () => Date.parse(T10));
      before.add("session:s1", { pid: 700, started: T10 }, "/w");
      const rebooted = { ...ops, bootedAtMs: () => Date.parse(T11) };
      expect(new RunningRegistry(file(), rebooted).cleanUp()).toEqual([]);
      writeFileSync(file(), "{ not json");
      expect(new RunningRegistry(file(), ops).cleanUp()).toEqual([]);
      writeFileSync(
        file(),
        JSON.stringify([{ key: "session:s1", pid: 700, identity: T10, cwd: "/w" }]),
      );
      expect(new RunningRegistry(file(), ops).cleanUp()).toEqual([]);
      expect(killed).toEqual([]);
    });

    it("forgets a process that ended", () => {
      const registry = new RunningRegistry(file(), ops);
      registry.add("session:s1", { pid: 700, started: T10 }, "/w");
      registry.remove(700);
      expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual([]);
    });
  });
});

describe("stopping a preview's processes", () => {
  /** A scripted system: the table changes as the test says, time moves when it sleeps. */
  function system(tables: ProcessRow[][]) {
    const sent: [number, string][] = [];
    let time = 0;
    let step = 0;
    const ops: ProcessOps = {
      table: () => tables[Math.min(step++, tables.length - 1)] as ProcessRow[],
      signal: (pid, signal) => sent.push([pid, signal]),
      sleep: async (ms) => {
        time += ms;
      },
      now: () => time,
    };
    return { ops, sent };
  }

  it("asks each of them to stop, by its own id, and forces nothing that went away", async () => {
    const { ops, sent } = system([TABLE, [row(1, 0, 1, T9), row(800, 1, 800)]]);
    await stopFamily(leader, 1000, ops);
    expect(sent).toEqual([
      [700, "SIGTERM"],
      [701, "SIGTERM"],
      [702, "SIGTERM"],
    ]);
  });

  it("forces what ignores the request after the grace time, and no group as a whole", async () => {
    const { ops, sent } = system([TABLE]);
    await stopFamily(leader, 200, ops);
    expect(
      sent
        .filter(([, s]) => s === "SIGKILL")
        .map(([pid]) => pid)
        .sort(),
    ).toEqual([700, 701, 702]);
    expect(sent.every(([pid]) => pid > 1)).toBe(true);
  });

  it("doesn't force an id that was handed to another process during the grace time", async () => {
    // 701 ends and its id goes to a stranger; 702 is still the same process.
    const after = [row(1, 0, 1, T9), row(701, 1, 701, T11), row(702, 1, 702), row(800, 1, 800)];
    const { ops, sent } = system([TABLE, after]);
    await stopFamily(leader, 100, ops);
    expect(sent.filter(([, s]) => s === "SIGKILL")).toEqual([[702, "SIGKILL"]]);
  });

  it("also ends what the processes started while they were being stopped", async () => {
    const grown = [...TABLE, row(703, 701, 700, T11)];
    const { ops, sent } = system([TABLE, grown]);
    await stopFamily(leader, 100, ops);
    expect(sent).toContainEqual([703, "SIGKILL"]);
  });

  it("signals nothing for a leader that can't be proven", async () => {
    const { ops, sent } = system([TABLE]);
    await stopFamily({ pid: 700, started: T9 }, 100, ops);
    await stopFamily({ pid: 700, started: null }, 100, ops);
    expect(sent).toEqual([]);
  });
});

describe("the command line of a preview", () => {
  it("hands the command to the person's shell whole, never as extra arguments", () => {
    const hostile = `echo hi; echo "$(id)" && rm -rf "$HOME"`;
    const { file, args } = shellInvocation(hostile, { SHELL: "/bin/zsh" }, "darwin");
    expect(file).toBe("/bin/zsh");
    expect(args).toEqual(["-l", "-c", hostile]);
    expect(shellInvocation("x", { SHELL: "/bin/bash" }, "linux").args).toEqual(["-c", "x"]);
    expect(shellInvocation("x", {}, "win32")).toEqual({
      file: "powershell.exe",
      args: ["-NoLogo", "-NonInteractive", "-Command", "x"],
    });
  });
});

describe("the port allocator", () => {
  it("skips taken and busy ports and moves on from the last one given", async () => {
    const busy = new Set([5001]);
    const allocator = new PortAllocator(async (port) => !busy.has(port));
    const range = { from: 5000, to: 5005 };
    expect(await allocator.next(2, range, new Set([5000]))).toEqual([5002, 5003]);
    expect(await allocator.next(1, range, new Set())).toEqual([5004]);
    expect(await allocator.next(2, range, new Set([5002, 5003, 5004]))).toEqual([5005, 5000]);
    expect(await allocator.next(3, range, new Set([5002, 5003, 5004, 5005]))).toBeNull();
  });
});
