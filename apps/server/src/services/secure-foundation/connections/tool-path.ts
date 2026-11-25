import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { runCli } from "./process";

/**
 * The PATH the Connections commands are looked up on. An app started from the Dock or a
 * launcher gets the system's bare PATH, without the folders a terminal adds (Homebrew, a Node
 * version manager), so `npx` and `doppler` would read as "not installed" there. This asks the
 * person's own shell for its PATH, each time it is called, and adds the usual install folders
 * that exist; the process's own PATH stays in front. Windows keeps its PATH as it is (the
 * setup check already refreshes it from the registry).
 */

const MARK = "__TOOL_PATH__";
const SHELL_TIMEOUT_MS = 5_000;

/** Where tools commonly live that a bare PATH leaves out. */
export function usualFolders(home: string): string[] {
  return ["/opt/homebrew/bin", "/usr/local/bin", join(home, ".local", "bin")];
}

/** The PATH the person's shell sets up (login and interactive, as a terminal would), or "". */
export async function shellPath(env: NodeJS.ProcessEnv, cwd: string): Promise<string> {
  if (process.platform === "win32") return "";
  const shell = env.SHELL && isAbsolute(env.SHELL) && existsSync(env.SHELL) ? env.SHELL : "/bin/sh";
  const interactive = /\/(?:zsh|bash)$/.test(shell);
  const result = await runCli(
    shell,
    [interactive ? "-ilc" : "-lc", `printf '${MARK}%s${MARK}' "$PATH"`],
    { cwd, env, timeoutMs: SHELL_TIMEOUT_MS, anyArgs: true },
  );
  const start = result.output.indexOf(MARK);
  const end = result.output.lastIndexOf(MARK);
  return start >= 0 && end > start ? result.output.slice(start + MARK.length, end) : "";
}

/** `base`'s PATH, then the shell's and the usual folders, each folder once. */
export async function toolPath(
  base: NodeJS.ProcessEnv,
  cwd: string,
  fromShell: (env: NodeJS.ProcessEnv, cwd: string) => Promise<string> = shellPath,
  usual: string[] = usualFolders(base.HOME ?? homedir()),
): Promise<string> {
  const own = base.PATH ?? "";
  if (process.platform === "win32") return own;
  let shell = "";
  try {
    shell = await fromShell(base, cwd);
  } catch {
    shell = "";
  }
  const extra = usual.filter((dir) => existsSync(dir));
  const seen = new Set<string>();
  const folders: string[] = [];
  for (const dir of [...own.split(delimiter), ...shell.split(delimiter), ...extra]) {
    if (!dir || !isAbsolute(dir) || seen.has(dir)) continue;
    seen.add(dir);
    folders.push(dir);
  }
  return folders.join(delimiter);
}
