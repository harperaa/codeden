/**
 * The two upstream-sync review automations a hardened fork gets
 * (`docs/codeharden-sync-cooldown.md`, "The two review automations").
 *
 * Their definitions are Markdown files the server ships (`apps/server/templates/harden-sync/`,
 * one file per automation, the only place their prompt is written). This module names which
 * files those are and how a project is recognised as a hardened fork. Everything here is a
 * constant of the app: the project's files are only looked at to decide whether to offer the
 * automations, and nothing from them is run or becomes part of a definition.
 */

/** The fork's configuration for its shell scripts, relative to the checkout. */
export const HARDEN_FORK_CONFIG_SCRIPT = "scripts/harden/fork-config.sh";

/** The workflow that merges an approved sync after its cooldown, relative to the checkout. */
export const HARDEN_SYNC_WORKFLOW = ".github/workflows/upstream-sync-merge.yml";

/**
 * The files a checkout must have, as plain files, to be offered the automations: this product's
 * repository or a fork of it. The server also asks for the workspace's root package
 * (`HARDEN_WORKSPACE_PACKAGE`), as the dev preview's recognition does.
 */
export const HARDEN_FORK_FILES: readonly string[] = [
  HARDEN_FORK_CONFIG_SCRIPT,
  HARDEN_SYNC_WORKFLOW,
];

/** The folder of the shipped definitions, beside the built-in templates' folder. */
export const HARDEN_SYNC_TEMPLATES_DIRNAME = "harden-sync";

/** One shipped automation: its file's name without `.md`, and the work key of its runs. */
export interface HardenSyncAutomation {
  /** File name without `.md`; a project's copy has the id `starter:<projectId>:<id>`. */
  readonly id: string;
  /**
   * Work key of its runs. An automation of the project that already has this key (one made by
   * hand before these were shipped) keeps the shipped one from being added beside it.
   */
  readonly workKey: string;
}

/** The first review, then the second: a fixed list, so no other file in the folder is offered. */
export const HARDEN_SYNC_AUTOMATIONS: readonly HardenSyncAutomation[] = [
  { id: "upstream-sync-review", workKey: "automation:upstream-sync-review" },
  { id: "upstream-sync-second-review", workKey: "automation:upstream-sync-second-review" },
];

/** The labels the reviews and the merge job use on a sync pull request. */
export const HARDEN_SYNC_LABELS = {
  /** The approval, set by the second review only; the cooldown starts when it is applied. */
  approved: "sync-approved",
  /** The first review's proposal to approve. The merge job ignores it. */
  firstPass: "sync-first-pass",
  /** A person must look, and merge by hand. */
  needsReview: "sync-needs-review",
  /** Held: a security concern, or a dependency that should not be installed. */
  hold: "sync-hold",
} as const;
