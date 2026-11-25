import type { PreviewExit } from "./process";

/** The code a shell exits with when the program it was asked to run isn't there. */
const NOT_FOUND_CODE = 127;

/**
 * How a shell says a program isn't there: `sh: next: command not found` (bash, zsh),
 * `sh: 1: next: not found` (dash), and `'next' is not recognized as an internal or external
 * command` or `... as the name of a cmdlet` (Windows).
 */
const NOT_FOUND_LINE =
  /command not found|^\S*sh: \d+: .+: not found$|is not recognized as (?:an internal or external command|the name of a cmdlet)/i;

/** A package manager adds a line or two of its own after the shell's. */
const LAST_LINES = 5;

/**
 * Did the dev command end the way one does whose programs aren't installed: exit code 127, or
 * a "command not found" line among the last it printed? That is all that is looked at. What it
 * means is for the caller to say, and only as a hint.
 */
export function endedAsNotInstalled(exit: PreviewExit, log: readonly string[]): boolean {
  if (exit.error) return false;
  if (exit.code === NOT_FOUND_CODE) return true;
  return log
    .filter((line) => line.trim())
    .slice(-LAST_LINES)
    .some((line) => NOT_FOUND_LINE.test(line.trim()));
}
