import { spawnSync } from "node:child_process";
import { uptime } from "node:os";

/**
 * Which running processes belong to a preview.
 *
 * The rule for everything that ends a process here: a process is signalled only when it is
 * proven to be one the app started, or one such a process started. A process id alone proves
 * nothing, since the system hands ids out again. The proof is the start time the system
 * reports for the id, compared with the one read when the app started the process.
 */

/** One process, as `ps` lists it. */
export interface ProcessRow {
  pid: number;
  ppid: number;
  /** The id of its process group. */
  pgid: number;
  /** Its start time as the system prints it. With the pid, this names one process. */
  started: string;
}

const isWindows = process.platform === "win32";

export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S.*?)\s*$/);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      started: match[4] as string,
    });
  }
  return rows;
}

/** Every process of the machine. Empty where it can't be read (and on Windows). */
export function processTable(): ProcessRow[] {
  if (isWindows) return [];
  const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid=,pgid=,lstart="], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return ps.status === 0 ? parseProcessTable(ps.stdout) : [];
}

/** The start time of one process, or null when it is gone or can't be read. */
export function startedAt(pid: number, table: ProcessRow[] = processTable()): string | null {
  return table.find((row) => row.pid === pid)?.started ?? null;
}

/** The processes a row's process started, directly or not. */
function descendants(table: readonly ProcessRow[], roots: readonly ProcessRow[]): ProcessRow[] {
  const children = new Map<number, ProcessRow[]>();
  for (const row of table) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const found = new Map<number, ProcessRow>();
  const queue = [...roots];
  while (queue.length > 0) {
    const next = queue.shift() as ProcessRow;
    for (const child of children.get(next.pid) ?? []) {
      if (found.has(child.pid) || roots.some((r) => r.pid === child.pid)) continue;
      found.set(child.pid, child);
      queue.push(child);
    }
  }
  return [...found.values()];
}

export interface Leader {
  pid: number;
  /** The leader's start time, read when the app started it. Null: nothing can be proven. */
  started: string | null;
  /**
   * When the app saw the leader end, if it did. Its group can outlive it; a member that
   * started before this moment was in the group while the group was the app's.
   */
  endedAtMs?: number;
}

/**
 * The processes that provably belong to a preview: its leader, the members of the leader's
 * process group, and everything those started. Never the app itself.
 *
 * - The leader counts only while the process with its id has the recorded start time.
 * - With the leader proven, its group is the app's: a group lives as long as it has a member,
 *   and only the process with that id can have made it.
 * - With the leader gone, the group's members count only when the app saw the leader end and
 *   every member started before that, and no process has the leader's id now. Anything else
 *   (a crash the app didn't see, an id that was handed out again) proves nothing: empty.
 */
export function familyOf(
  table: readonly ProcessRow[],
  leader: Leader,
  self: number = process.pid,
): ProcessRow[] {
  if (!leader.started || leader.pid <= 1) return [];
  const current = table.find((row) => row.pid === leader.pid);
  const group = table.filter((row) => row.pgid === leader.pid && row.pid !== leader.pid);
  let proven: ProcessRow[];
  if (current && current.started === leader.started) {
    proven = [current, ...group];
  } else {
    if (current || leader.endedAtMs === undefined) return [];
    const ended = leader.endedAtMs;
    // `ps` prints whole seconds: a member started within the leader's last second counts.
    const before = (row: ProcessRow) => {
      const at = Date.parse(row.started);
      return Number.isFinite(at) && at <= ended + 1_000;
    };
    if (!group.every(before)) return [];
    proven = group;
  }
  return [...proven, ...descendants(table, proven)].filter((row) => row.pid !== self);
}

/** The rows that still name the same processes in a newer table. */
export function stillThere(
  rows: readonly ProcessRow[],
  table: readonly ProcessRow[],
): ProcessRow[] {
  return rows.filter((row) =>
    table.some((now) => now.pid === row.pid && now.started === row.started),
  );
}

/** When this computer started, give or take a second. */
export function bootTimeMs(now: number = Date.now(), uptimeSec: number = uptime()): number {
  return now - uptimeSec * 1000;
}
