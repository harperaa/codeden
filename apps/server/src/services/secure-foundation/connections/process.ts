import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { resolveExecutable } from "../../exec";

/**
 * Running a service's own CLI for the sign-in checks: without a shell, from an argument
 * array, with a minimal environment, in a scratch folder that isn't a project.
 */

const isWindows = process.platform === "win32";

/** What a CLI needs to find itself, its own saved sign-in and the network. Nothing else. */
const KEEP = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  // Windows
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "COMSPEC",
  "PATHEXT",
  "USERNAME",
  "HOMEDRIVE",
  "HOMEPATH",
];

/** The environment a CLI runs in: the few variables above, and no colour codes in its output. */
export function minimalEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keep = new Set(KEEP.map((k) => k.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    const wanted = isWindows ? keep.has(key.toUpperCase()) : KEEP.includes(key);
    if (wanted && value !== undefined) env[key] = value;
  }
  return { ...env, NO_COLOR: "1", FORCE_COLOR: "0" };
}

/** Arguments are fixed in code; this is the last check that none could be read as shell text. */
const SAFE_ARG = /^[\w.:\\/@=+,[\]-]+$/;

export interface CliProcess {
  /** Null when the program isn't installed (nothing was started). */
  child: ChildProcess | null;
  /** Stop the process and everything it started. Safe to call twice. */
  kill(): void;
}

/**
 * Start `program` with `args`. The child gets no stdin (a CLI that would prompt gets
 * end-of-file instead of waiting), its own process group so `kill` takes its children too, and
 * its output through `onOutput`.
 */
export function startCli(
  program: string,
  args: readonly string[],
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    onOutput: (text: string) => void;
    /** For the one fixed shell line that reads the person's PATH (never a service command). */
    anyArgs?: boolean;
  },
): CliProcess {
  const resolved = resolveExecutable(program, opts.env);
  if (!resolved) return { child: null, kill: () => {} };
  for (const arg of opts.anyArgs ? [] : args) {
    if (!SAFE_ARG.test(arg)) throw new Error(`Unsafe argument for ${program}`);
  }
  const shim = isWindows && /\.(cmd|bat)$/i.test(resolved);
  const file = shim
    ? (opts.env.COMSPEC ?? join(opts.env.SYSTEMROOT ?? "C:\\Windows", "System32", "cmd.exe"))
    : resolved;
  const argv = shim ? ["/d", "/s", "/c", `"${[`"${resolved}"`, ...args].join(" ")}"`] : [...args];
  const child = spawn(file, argv, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWindows,
    windowsHide: true,
    windowsVerbatimArguments: shim,
  });
  child.stdout?.setEncoding("utf8").on("data", opts.onOutput);
  child.stderr?.setEncoding("utf8").on("data", opts.onOutput);
  let killed = false;
  return {
    child,
    kill() {
      if (killed || !child.pid) return;
      killed = true;
      if (isWindows) {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
        return;
      }
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    },
  };
}

export interface CliResult {
  /** Null when it didn't start, was killed or timed out. */
  code: number | null;
  output: string;
  notFound: boolean;
  timedOut: boolean;
}

/** Run a CLI to its end, with a deadline. Output is capped; it is never logged. */
export function runCli(
  program: string,
  args: readonly string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; anyArgs?: boolean },
): Promise<CliResult> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const cli = startCli(program, args, {
      ...opts,
      onOutput: (text) => {
        if (output.length < 200_000) output += text;
      },
    });
    if (!cli.child) return resolve({ code: null, output: "", notFound: true, timedOut: false });
    const timer = setTimeout(() => {
      timedOut = true;
      cli.kill();
    }, opts.timeoutMs);
    const done = (code: number | null) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, output, notFound: false, timedOut });
    };
    cli.child.on("error", () => done(null));
    cli.child.on("close", (code) => done(code));
  });
}
