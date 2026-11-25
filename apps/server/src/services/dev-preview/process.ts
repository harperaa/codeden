import { spawn } from "node:child_process";
import { agentEnv, defaultShell, defaultShellArgs, shellSyntax } from "@codeden/providers";
import {
  familyOf,
  type Leader,
  type ProcessRow,
  processTable,
  startedAt,
  stillThere,
} from "./process-table";

/**
 * Running a project's confirmed command for a preview.
 *
 * The command is the text a person typed and confirmed in the project's settings, handed whole
 * to their own shell (`<shell> -c <command>`), as if they had typed it into a terminal in that
 * folder. Nothing is ever added to that text here: ports reach the process in its environment.
 * The process gets what a session's terminal would: the worktree as its working directory and
 * the person's environment without the app's own variables (`agentEnv`).
 */

const isWindows = process.platform === "win32";

/** Variables a git hook sets. A dev server started from one must not inherit its repository. */
const GIT_LOCAL = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR"];

/** The environment of a preview's processes. `extra` wins over what is inherited. */
export function previewEnv(
  extra: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = agentEnv({}, base);
  for (const name of GIT_LOCAL) delete env[name];
  return { ...env, ...extra };
}

/** The program and arguments that run `command` in the person's shell. */
export function shellInvocation(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[] } {
  const shell = defaultShell(env, platform);
  const syntax = shellSyntax(shell);
  if (syntax === "powershell") {
    return { file: shell, args: ["-NoLogo", "-NonInteractive", "-Command", command] };
  }
  if (syntax === "cmd") return { file: shell, args: ["/d", "/s", "/c", command] };
  return { file: shell, args: [...defaultShellArgs(shell, platform), "-c", command] };
}

export interface PreviewExit {
  code: number | null;
  signal: string | null;
  /** The shell itself couldn't be started. */
  error?: string;
}

export interface PreviewProcess {
  /** Also the id of its process group (not on Windows). */
  readonly pid: number;
  /** Its start time as the system reports it, read at once; with the pid it names it. */
  readonly started: string | null;
  /** Resolves once, when the command's own process has ended. */
  readonly exited: Promise<PreviewExit>;
  /** End it and everything it started: ask first, then force after `graceMs`. */
  stop(graceMs?: number): Promise<void>;
  /** Force it to end now, without waiting. For the moment the app itself exits. */
  killNow(): void;
}

export interface SpawnSpec {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onOutput: (text: string) => void;
}

export type SpawnPreview = (spec: SpawnSpec) => PreviewProcess;

/** What ending a process needs from the system; replaced in tests. */
export interface ProcessOps {
  table: () => ProcessRow[];
  signal: (pid: number, signal: NodeJS.Signals) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const systemOps: ProcessOps = {
  table: processTable,
  signal(pid, sig) {
    try {
      process.kill(pid, sig);
    } catch {
      // Already gone, or not ours to signal.
    }
  },
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
};

/**
 * End a preview's processes: its leader, its group and what those started, as far as they
 * are proven to be the preview's (`familyOf`). Each is signalled by its own id, and only
 * while the id still names the process that was seen: SIGTERM first, and after `graceMs`
 * SIGKILL for what is left, looked up afresh. No process group is ever signalled as a whole.
 */
export async function stopFamily(
  leader: Leader,
  graceMs: number,
  ops: ProcessOps = systemOps,
): Promise<void> {
  const asked = familyOf(ops.table(), leader);
  for (const row of asked) ops.signal(row.pid, "SIGTERM");
  const deadline = ops.now() + graceMs;
  let left = asked;
  while (left.length > 0 && ops.now() < deadline) {
    await ops.sleep(Math.min(50, Math.max(5, graceMs / 10)));
    left = stillThere(asked, ops.table());
  }
  killFamilyNow(leader, asked, ops);
}

/** Force what is proven to be the preview's to end, at once. */
export function killFamilyNow(
  leader: Leader,
  seen: readonly ProcessRow[] = [],
  ops: ProcessOps = systemOps,
): void {
  const table = ops.table();
  const targets = new Map<number, ProcessRow>();
  // What was seen and is still the same process, and whatever the family has now.
  for (const row of [...stillThere(seen, table), ...familyOf(table, leader)]) {
    targets.set(row.pid, row);
  }
  for (const row of targets.values()) ops.signal(row.pid, "SIGKILL");
}

/** Start `spec.command` in the person's shell, in its own process group, with no stdin. */
export const spawnPreview: SpawnPreview = (spec) => {
  // The shell is chosen from the environment the command gets, as a terminal's would be.
  const { file, args } = shellInvocation(spec.command, { ...process.env, ...spec.env });
  const child = spawn(file, args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWindows,
    windowsHide: true,
  });
  child.stdout?.setEncoding("utf8").on("data", spec.onOutput);
  child.stderr?.setEncoding("utf8").on("data", spec.onOutput);
  const pid = child.pid ?? 0;
  // Read while the child can't have been replaced: it hasn't been reaped yet.
  const started = pid ? startedAt(pid) : null;
  let endedAtMs: number | undefined;
  const exited = new Promise<PreviewExit>((resolve) => {
    child.once("error", (error) => {
      endedAtMs ??= Date.now();
      resolve({ code: null, signal: null, error: error.message });
    });
    child.once("exit", (code, sig) => {
      endedAtMs ??= Date.now();
      resolve({ code, signal: sig });
    });
  });
  const leader = (): Leader => ({ pid, started, endedAtMs });
  /** Windows has no process groups to read: the tree of the live child, by its handle's id. */
  const killTreeOnWindows = () => {
    if (endedAtMs !== undefined) return;
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  };
  return {
    pid,
    started,
    exited,
    async stop(graceMs = 5_000) {
      if (!pid) return;
      if (isWindows) killTreeOnWindows();
      else await stopFamily(leader(), graceMs);
      // The processes can be gone a moment before node reports the exit.
      if (endedAtMs === undefined) await Promise.race([exited, systemOps.sleep(1_000)]);
    },
    killNow() {
      if (!pid) return;
      if (isWindows) killTreeOnWindows();
      else killFamilyNow(leader());
    },
  };
};
