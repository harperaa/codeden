import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HARDEN_FORK_FILES, HARDEN_WORKSPACE_PACKAGE } from "@codeden/contracts";

/**
 * What a project folder is recognised as, from a few facts read off its files. One place for
 * it: the dev preview's offered settings and the upstream-sync review automations both ask
 * here. Everything is read only: nothing of the project is run, a link never counts as a file,
 * and no text from the repository is passed on (the answers are yes or no).
 */

/** The project folder's `package.json`, or null when there is none that can be read. */
export function rootPackage(projectPath: string): { name?: unknown; scripts?: unknown } | null {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(projectPath, "package.json"), "utf8"));
    return typeof pkg === "object" && pkg !== null ? pkg : null;
  } catch {
    return null;
  }
}

/** True when `relative` is a plain file in the project folder (a link to one doesn't count). */
export function isPlainFile(projectPath: string, relative: string): boolean {
  try {
    return lstatSync(join(projectPath, relative)).isFile();
  } catch {
    return false;
  }
}

/**
 * A checkout of this product's workspace: its root package has the workspace's name. True for
 * this repository and for a fork of it, whatever its origin and whatever package it publishes
 * (the published name is a repository variable, not the root package's name).
 */
export function isHardenWorkspace(projectPath: string): boolean {
  return rootPackage(projectPath)?.name === HARDEN_WORKSPACE_PACKAGE;
}

/**
 * A checkout of a hardened fork (this repository or a fork of it): the workspace, with the
 * fork's configuration script and the workflow that merges an approved sync, both as plain
 * files (`HARDEN_FORK_FILES`).
 *
 * Any repository can be made to look like this, so being recognised must never switch anything
 * on: what is offered for it arrives off, with fixed text, and a person switches it on.
 */
export function isHardenedForkCheckout(projectPath: string): boolean {
  return (
    isHardenWorkspace(projectPath) && HARDEN_FORK_FILES.every((f) => isPlainFile(projectPath, f))
  );
}
