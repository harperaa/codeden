import { SecureFoundationRepoSecretKind, SecureFoundationRepoSecretName } from "@codeden/contracts";
import type { CliResult } from "../connections/process";

/**
 * Asking GitHub which repository secrets and variables exist, through the person's own `gh`.
 * Two fixed commands, as argument arrays, and they ask for names only: a secret's value can't
 * be read from GitHub at all, and a variable's value is never asked for. Nothing `gh` prints is
 * logged, stored or shown: only the names it lists are kept, and a failure gets one of the
 * fixed sentences below.
 */

/** Runs `gh` with these arguments and gives its result. */
export type GhRun = (args: readonly string[]) => Promise<CliResult>;

export const GH_TIMEOUT_MS = 20_000;

/** `gh secret list --repo <owner>/<repo> --json name`, or the same for variables. */
export function listArgs(kind: SecureFoundationRepoSecretKind, repository: string): string[] {
  return [
    kind === "secret" ? "secret" : "variable",
    "list",
    "--repo",
    repository,
    "--json",
    "name",
  ];
}

export interface ExistingNames {
  /** The names GitHub listed, in upper case; null when it couldn't be asked. */
  names: Set<string> | null;
  /** Why it couldn't be asked, for the person. */
  problem: string | null;
}

/** The names in `gh`'s JSON (`[{"name":"X"}]`), or null when the output isn't that. */
function namesIn(output: string): Set<string> | null {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let listed: unknown;
  try {
    listed = JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(listed)) return null;
  const names = new Set<string>();
  for (const entry of listed.slice(0, 2_000)) {
    const raw = entry && typeof entry === "object" ? (entry as { name?: unknown }).name : null;
    if (typeof raw !== "string") continue;
    const name = SecureFoundationRepoSecretName.safeParse(raw.toUpperCase());
    if (name.success) names.add(name.data);
  }
  return names;
}

function problemOf(result: CliResult): string {
  if (result.notFound) {
    return "The GitHub command-line tool (`gh`) isn't installed, or isn't on the app's path.";
  }
  if (result.timedOut) return "GitHub took too long to answer.";
  if (/gh auth login|not logged in|authentication required/i.test(result.output)) {
    return "`gh` isn't signed in to GitHub on this computer: run `gh auth login` in your own terminal.";
  }
  if (/HTTP 40[134]/.test(result.output)) {
    return "This GitHub sign-in can't read the repository's settings, or the repository isn't there.";
  }
  return "GitHub didn't answer.";
}

/** Which names of this kind the repository has. Never throws. */
export async function existingNames(
  run: GhRun,
  kind: SecureFoundationRepoSecretKind,
  repository: string,
): Promise<ExistingNames> {
  let result: CliResult;
  try {
    result = await run(listArgs(SecureFoundationRepoSecretKind.parse(kind), repository));
  } catch {
    return { names: null, problem: "GitHub couldn't be asked." };
  }
  const names = result.code === 0 ? namesIn(result.output) : null;
  return names ? { names, problem: null } : { names: null, problem: problemOf(result) };
}
