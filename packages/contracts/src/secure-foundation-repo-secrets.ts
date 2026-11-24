import { z } from "zod";
import { Timestamp } from "./common";
import {
  HARDEN_PRODUCT_NAME,
  HARDEN_TEMPLATE_BRANCH,
  HARDEN_TEMPLATE_REPOSITORY,
} from "./harden-channel";
import type { SecureFoundationSecrets } from "./secure-foundation";

/**
 * The repository secrets and variables the workflows of a Secure Foundation project use
 * (`docs/secure-foundation.md`, "Repository secrets the project's workflows need"). GitHub
 * copies no secret from a template, so a workflow the template ships can fail on every pull
 * request until the person adds one. This is the list the project page shows: each name the
 * project's own workflow files reference, whether the repository has it, what it is for and the
 * steps to add it.
 *
 * Names only. A secret's value can't be read from GitHub and is never asked for, typed into the
 * app, put on a command line or stored: the person adds it themselves, on GitHub or in their
 * own terminal. Routes: `GET /api/secure-foundation/projects/:id/repository-secrets` and
 * `POST …/repository-secrets/check` (this computer only).
 */

/** A repository secret, or a repository variable (`secrets.NAME`, `vars.NAME`). */
export const SecureFoundationRepoSecretKind = z.enum(["secret", "variable"]);
export type SecureFoundationRepoSecretKind = z.infer<typeof SecureFoundationRepoSecretKind>;

/**
 * A secret's or variable's name as GitHub stores it: upper case, letters, digits and
 * underscores, not starting with a digit. Nothing else is ever written into a command the
 * person is shown.
 */
const NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
export const SecureFoundationRepoSecretName = z.string().regex(NAME);

/**
 * The name a workflow's reference means, or null when it isn't one the person can add: GitHub
 * compares names without regard to case and stores them in upper case; it refuses anything but
 * letters, digits and underscores, and keeps the `GITHUB_` prefix for itself (`GITHUB_TOKEN` is
 * given to every run).
 */
export function repoSecretName(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 128) return null;
  const name = raw.toUpperCase();
  return NAME.test(name) && !name.startsWith("GITHUB_") ? name : null;
}

/** `owner/repo` when both are plain GitHub names, else null: the only form put into a command. */
export function repoSecretsRepository(owner: unknown, repo: unknown): string | null {
  if (typeof owner !== "string" || typeof repo !== "string") return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)) return null;
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/.test(repo)) return null;
  return repo.endsWith(".git") || repo.endsWith(".") ? null : `${owner}/${repo}`;
}

/** An event of a workflow's `on:`, and whether it is narrowed to some branches or paths. */
export const SecureFoundationWorkflowEvent = z.object({
  name: z.string().max(60),
  filtered: z.boolean(),
});
export type SecureFoundationWorkflowEvent = z.infer<typeof SecureFoundationWorkflowEvent>;

/** Where one workflow file uses a name. */
export const SecureFoundationRepoSecretUse = z.object({
  /** The file's name inside `.github/workflows/`. */
  workflow: z.string().max(120),
  /** The ids of the jobs that use it. Empty: it is used outside a job, for the whole workflow. */
  jobs: z.array(z.string().max(100)).max(40),
  /** What starts the workflow. */
  events: z.array(SecureFoundationWorkflowEvent).max(40),
  /** `@claude` when every one of those jobs only runs when something mentions that name. */
  mention: z.string().max(60).nullable(),
});
export type SecureFoundationRepoSecretUse = z.infer<typeof SecureFoundationRepoSecretUse>;

/** One name the scan of the workflow files found. */
export interface RepoSecretReference {
  kind: SecureFoundationRepoSecretKind;
  name: string;
  uses: SecureFoundationRepoSecretUse[];
}

/**
 * `set` and `missing` are what GitHub answered. `not_needed`: missing, and this project works
 * without it. `unknown`: GitHub couldn't be asked, or the project has no repository yet.
 */
export const SecureFoundationRepoSecretState = z.enum(["set", "missing", "not_needed", "unknown"]);
export type SecureFoundationRepoSecretState = z.infer<typeof SecureFoundationRepoSecretState>;

/** One name with everything the person is told about it. Backticks mark commands and names. */
export const SecureFoundationRepoSecret = z.object({
  kind: SecureFoundationRepoSecretKind,
  name: SecureFoundationRepoSecretName,
  state: SecureFoundationRepoSecretState,
  uses: z.array(SecureFoundationRepoSecretUse).max(20),
  /** Which workflows and jobs use it and when they run, as sentences. */
  where: z.string().max(16_000),
  /** What it is for, for a name the product knows; null for any other. */
  purpose: z.string().max(600).nullable(),
  /** What happens while it isn't set, or why nothing has to be done. */
  consequence: z.string().max(1000),
  /** How the person adds it. Empty when there is nothing to do. */
  steps: z.array(z.string().max(1000)).max(8),
  /** The page the steps come from; null for the generic steps. */
  source: z
    .object({ title: z.string().max(200), url: z.string().max(500).startsWith("https://") })
    .nullable(),
});
export type SecureFoundationRepoSecret = z.infer<typeof SecureFoundationRepoSecret>;

export const SecureFoundationRepoSecrets = z.object({
  /** Secure Foundation set this project up. False for any other project. */
  applies: z.boolean(),
  /** The project's GitHub repository, `owner/repo`; null while it has none. */
  repository: z.string().max(200).nullable(),
  /** When the workflow files were read; null when nothing was checked. */
  checkedAt: Timestamp.nullable(),
  /**
   * `checked`: GitHub said which names exist. `unavailable`: it couldn't be asked (`message`
   * says why), so the names are listed without knowing which are set. `no_repository`: there
   * is nothing to ask yet.
   */
  github: z.enum(["checked", "unavailable", "no_repository"]),
  message: z.string().max(600).nullable(),
  items: z.array(SecureFoundationRepoSecret).max(60),
  /** Jobs that hand every secret to another workflow (`secrets: inherit`). */
  inherits: z.array(z.object({ workflow: z.string().max(120), job: z.string().max(100) })).max(20),
  /** Workflow files that weren't read: too many, or too large. */
  skipped: z.number().int().min(0),
  /** "Check again" works from this device (the computer running the app). */
  canCheck: z.boolean(),
});
export type SecureFoundationRepoSecrets = z.infer<typeof SecureFoundationRepoSecrets>;

/** The answer for a project Secure Foundation didn't set up, and for another device with nothing kept. */
export const SECURE_FOUNDATION_NO_REPO_SECRETS: SecureFoundationRepoSecrets = {
  applies: false,
  repository: null,
  checkedAt: null,
  github: "no_repository",
  message: null,
  items: [],
  inherits: [],
  skipped: 0,
  canCheck: false,
};

// ------------------------------------------------------------------ wording

/** What an event reads as; unknown ones are named as they are written. */
const EVENT_PHRASE: Record<string, string> = {
  pull_request: "on every pull request",
  pull_request_target: "on every pull request",
  push: "on every push",
  schedule: "on a schedule",
  workflow_dispatch: "when someone starts it by hand",
  workflow_call: "when another workflow calls it",
  issues: "on issues",
  issue_comment: "on issue and pull request comments",
  pull_request_review: "on pull request reviews",
  pull_request_review_comment: "on review comments",
  release: "on releases",
  merge_group: "in the merge queue",
};

/** The events a branch or path filter narrows, as they read then. */
const NARROWED: Record<string, string> = {
  pull_request: "pull requests",
  pull_request_target: "pull requests",
  push: "pushes",
};

const list = (parts: string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/** The first few of a long list, then how many more of `what` there are. */
function some(parts: string[], what: string, most = 6): string[] {
  const more = parts.length - most;
  return more > 0 ? [...parts.slice(0, most), `${more} more ${what}`] : parts;
}

/**
 * When a use runs: "on every pull request", "on pushes and pull requests to the branches or
 * paths it names", "only when someone mentions @claude".
 */
export function repoSecretRuns(
  use: Pick<SecureFoundationRepoSecretUse, "events" | "mention">,
): string {
  if (use.mention) return `only when someone mentions ${use.mention}`;
  const phrases: string[] = [];
  const narrowed: string[] = [];
  for (const event of use.events) {
    const noun = event.filtered ? NARROWED[event.name] : undefined;
    if (noun) {
      if (!narrowed.includes(noun)) narrowed.push(noun);
      continue;
    }
    const phrase = EVENT_PHRASE[event.name] ?? `on \`${event.name}\``;
    if (!phrases.includes(phrase)) phrases.push(phrase);
  }
  if (narrowed.length > 0) {
    phrases.unshift(`on ${list(narrowed)} to the branches or paths it names`);
  }
  if (phrases.length === 0) return "when its workflow runs";
  return phrases.length > 6 ? `${list(phrases.slice(0, 6))} and on other events` : list(phrases);
}

/** One sentence per workflow file: which jobs use the name and when they run. */
export function repoSecretWhere(uses: SecureFoundationRepoSecretUse[]): string {
  const more = uses.length - 8;
  const sentences = uses.slice(0, 8).map((use) => {
    const jobs =
      use.jobs.length === 0
        ? "the whole workflow"
        : `${use.jobs.length === 1 ? "job" : "jobs"} ${list(
            some(
              use.jobs.map((j) => `\`${j}\``),
              "jobs",
            ),
          )}`;
    const called =
      use.events.length === 1 && use.events[0]?.name === "workflow_call"
        ? " (a called workflow gets its secrets from the workflow that calls it, so this may be the caller's name for it)"
        : "";
    return `\`${use.workflow}\` (${jobs}) runs ${repoSecretRuns(use)}${called}.`;
  });
  if (more > 0) sentences.push(`And ${more} more workflow ${more === 1 ? "file" : "files"}.`);
  return sentences.join(" ");
}

// -------------------------------------------------------------- known names

/** What the steps of a known name depend on. */
export interface RepoSecretContext {
  /** `owner/repo` (`repoSecretsRepository`): the only thing put into a command besides the name. */
  repository: string;
  /** Where the project keeps its secrets; null when the app kept no answer for it. */
  secrets: SecureFoundationSecrets | null;
}

export interface KnownRepoSecret {
  /** What it is for. */
  purpose: string;
  /** What the jobs that use it do while it isn't set. */
  without: string;
  /** Why this project works without it, or null when it needs it. */
  notNeeded?: (context: RepoSecretContext) => string | null;
  steps: (context: RepoSecretContext) => string[];
  /** Where the steps come from. */
  source: () => { title: string; url: string } | null;
}

const CHECK_AGAIN =
  "Then press Check again here. A run that already failed stays failed: run it again on GitHub, or push again.";

/** How a repository secret is added by hand, the value typed where only GitHub sees it. */
function addSecret(name: string, repository: string): string {
  return `Store it as the repository secret \`${name}\`: on GitHub, open the repository's Settings › Secrets and variables › Actions and press New repository secret. Or run \`gh secret set ${name} --repo ${repository}\` in your own terminal and paste the value when it asks (it isn't shown as you type).`;
}

/**
 * The names the product knows, with specific steps. Any other name gets the generic steps
 * (`describeRepoSecret`), so a secret the template adds later is still listed. A fork with
 * another template changes this table.
 *
 * `CLAUDE_CODE_OAUTH_TOKEN`: the template's Claude review workflows read it. The setup never
 * sets it: creating it needs the person's own Claude sign-in, and the token would pass through
 * the setup session's transcript. Where the template's `/deploy-to-dev` asks for it, the session
 * only checks the repository's secret names and continues; it is the person's to add, with
 * these steps, which the session's last message repeats (`claudeTokenMessage` in the server's
 * setup brief). The steps are Claude Code's own,
 * from its "Claude Code GitHub Actions" guide (manual setup) and its "Authentication" page
 * (`claude setup-token`).
 * `DOPPLER_TOKEN`: the template's own step (`scripts/setup.mjs doppler-create-ci-token`, in its
 * `.claude/commands/install.md`); the setup session runs it as part of the deploy, so after a
 * deploy with Doppler this secret is set.
 */
export const SECURE_FOUNDATION_KNOWN_REPO_SECRETS: Record<string, KnownRepoSecret> = {
  CLAUDE_CODE_OAUTH_TOKEN: {
    purpose: `The sign-in of the template's Claude review workflows (the \`anthropics/claude-code-action\` action). They run on GitHub's servers, not on this computer, so they need a token for your own Claude subscription stored in the repository. The setup doesn't add it: creating it needs your own Claude sign-in, and the token would have passed through the setup session's transcript. Reviews you run inside ${HARDEN_PRODUCT_NAME} use your own subscription on this computer and don't need it.`,
    without:
      "Without it the template's Claude review checks have no sign-in and fail shortly after they start, each time they run (the review on every pull request), unless the workflow itself skips them.",
    steps: ({ repository }) => [
      "In your own terminal (not in an agent session), run `claude setup-token` (a command of Claude Code; it needs a Claude subscription). It prints a token that is valid for one year and saves it nowhere: copy it.",
      addSecret("CLAUDE_CODE_OAUTH_TOKEN", repository),
      "Install the Claude GitHub App on the repository if it isn't there yet: https://github.com/apps/claude. Claude Code's guide has it as the first step of a manual setup.",
      CHECK_AGAIN,
    ],
    source: () => ({
      title: "Claude Code GitHub Actions (Claude Code's documentation)",
      url: "https://code.claude.com/docs/en/github-actions",
    }),
  },
  DOPPLER_TOKEN: {
    purpose:
      "A read-only Doppler token for the `dev` config, so the CI build can read the app's settings from Doppler.",
    without:
      "Without it the template's CI builds without Doppler, and that build can fail on the settings it doesn't have.",
    notNeeded: ({ secrets }) =>
      secrets === "env_local"
        ? "This project keeps its secrets in `.env.local`, not in Doppler, so there is no Doppler token to store: the template's CI builds without it."
        : null,
    steps: ({ secrets }) => [
      ...(secrets === null
        ? [
            "Only when this project's secrets are in Doppler. With `.env.local` there is nothing to add.",
          ]
        : []),
      "In a terminal in the project folder, run `node scripts/setup.mjs doppler-create-ci-token` (the template's own step; `doppler` and `gh` have to be signed in). It creates a read-only Doppler service token named `github-actions-ci` for the `dev` config and stores it as this secret itself.",
      CHECK_AGAIN,
    ],
    source: () =>
      HARDEN_TEMPLATE_REPOSITORY
        ? {
            title: "The template's install guide (Doppler post-init)",
            url: `https://github.com/${HARDEN_TEMPLATE_REPOSITORY}/blob/${HARDEN_TEMPLATE_BRANCH}/.claude/commands/install.md`,
          }
        : null,
  },
};

/**
 * Everything the person is told about one name: where it is used, what it is for, what happens
 * without it and how to add it. `exists` is what GitHub answered for the name; null when it
 * couldn't be asked. `context` is null while the project has no repository: then there are no
 * steps yet, since every step names the repository.
 */
export function describeRepoSecret(
  reference: RepoSecretReference,
  exists: boolean | null,
  context: RepoSecretContext | null,
): SecureFoundationRepoSecret {
  const { kind, name, uses } = reference;
  const known = kind === "secret" ? SECURE_FOUNDATION_KNOWN_REPO_SECRETS[name] : undefined;
  const where = repoSecretWhere(uses);
  const base = { kind, name, uses, where, purpose: known?.purpose ?? null };
  if (exists === true) {
    return {
      ...base,
      state: "set",
      consequence: "It is set in the repository.",
      steps: [],
      source: null,
    };
  }
  const spared = context ? (known?.notNeeded?.(context) ?? null) : null;
  if (spared) {
    return { ...base, state: "not_needed", consequence: spared, steps: [], source: null };
  }
  const without =
    known?.without ??
    (kind === "secret"
      ? "Until it is set these jobs get an empty value for it, and usually fail."
      : "Until it is set these jobs get an empty value for it, and may fail or do the wrong thing.");
  const consequence =
    exists === null ? `Whether it is set couldn't be checked. ${without}` : without;
  if (!context) return { ...base, state: "unknown", consequence, steps: [], source: null };
  const generic =
    kind === "secret"
      ? [
          "What value it takes is for you to find out from the workflow that uses it: only its name is known here.",
          addSecret(name, context.repository),
          CHECK_AGAIN,
        ]
      : [
          "What value it takes is for you to find out from the workflow that uses it: only its name is known here.",
          `Add it as the repository variable \`${name}\`: on GitHub, open the repository's Settings › Secrets and variables › Actions, the Variables tab, and press New repository variable. Or run \`gh variable set ${name} --repo ${context.repository}\` in your own terminal and type the value when it asks.`,
          CHECK_AGAIN,
        ];
  return {
    ...base,
    state: exists === null ? "unknown" : "missing",
    consequence,
    steps: known ? known.steps(context) : generic,
    source: known ? known.source() : null,
  };
}
