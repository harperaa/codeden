import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../json-file";
import { systemOps } from "./process";
import { bootTimeMs, familyOf, type ProcessRow, processTable } from "./process-table";

/**
 * What the app started and hasn't seen end, written to `<home>/dev-preview/running.json`, so
 * that a start after a crash can end what the crash left running. A normal quit stops every
 * preview and leaves the file empty.
 *
 * A record is acted on only when the process it names is proven to be the one recorded
 * (`familyOf`): it was started since this computer last started, and the process with that id
 * has the recorded start time. Then it, its group and what they started are ended. Anything
 * less (an id that went to another process, a record from before a reboot, a start time that
 * couldn't be read, a leader that is gone) proves nothing, and nothing is signalled.
 */
const RunningRecord = z.object({
  key: z.string(),
  pid: z.int().positive(),
  /** The process's start time as the system reported it at the start; null when unreadable. */
  started: z.string().nullable(),
  /** When the app started it. */
  spawnedAt: z.number(),
  cwd: z.string(),
});
export type RunningRecord = z.infer<typeof RunningRecord>;

/** What the cleanup asks the system; replaced in tests. */
export interface LeftoverOps {
  table: () => ProcessRow[];
  /** When this computer started. */
  bootedAtMs: () => number;
  kill: (pid: number) => void;
}

export const systemLeftoverOps: LeftoverOps = {
  table: processTable,
  bootedAtMs: () => bootTimeMs(),
  kill: (pid) => systemOps.signal(pid, "SIGKILL"),
};

/** The clocks of two readings can differ by a little. */
const BOOT_SLACK_MS = 10_000;

/** The processes this record proves to be the app's own leftovers; empty when it proves none. */
export function leftoversOf(
  record: RunningRecord,
  table: readonly ProcessRow[],
  bootedAtMs: number,
): ProcessRow[] {
  // From before this computer last started: every id has been handed out again since.
  if (record.spawnedAt < bootedAtMs - BOOT_SLACK_MS) return [];
  // No `endedAtMs`: the app didn't see the leader end, so a leaderless group proves nothing.
  return familyOf(table, { pid: record.pid, started: record.started });
}

export class RunningRegistry {
  private records: RunningRecord[] = [];

  constructor(
    private readonly file: string,
    private readonly ops: LeftoverOps = systemLeftoverOps,
    private readonly now: () => number = Date.now,
  ) {}

  /** Note a process the app just started, with the start time read at that moment. */
  add(key: string, proc: { pid: number; started: string | null }, cwd: string): void {
    if (!proc.pid) return;
    this.records = this.records.filter((r) => r.pid !== proc.pid);
    this.records.push({ key, pid: proc.pid, started: proc.started, spawnedAt: this.now(), cwd });
    this.write();
  }

  /** The process ended, or the app ended it. */
  remove(pid: number): void {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.pid !== pid);
    if (this.records.length !== before) this.write();
  }

  /**
   * End what an earlier run of the app left behind, and start with an empty list. Returns the
   * keys of the previews whose processes were ended.
   */
  cleanUp(): string[] {
    const parsed = z.array(RunningRecord).safeParse(readJsonFile(this.file));
    const records = parsed.success ? parsed.data : [];
    const ended: string[] = [];
    if (records.length > 0) {
      const table = this.ops.table();
      const booted = this.ops.bootedAtMs();
      for (const record of records) {
        const family = leftoversOf(record, table, booted);
        if (family.length === 0) continue;
        for (const row of family) this.ops.kill(row.pid);
        ended.push(record.key);
      }
    }
    this.records = [];
    this.write();
    return ended;
  }

  private write(): void {
    try {
      writeJsonFile(this.file, this.records, 0o600);
    } catch {
      // Without the file a crash leaves its processes behind; the previews still work.
    }
  }
}
