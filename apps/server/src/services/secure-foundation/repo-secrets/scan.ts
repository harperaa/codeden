import {
  type RepoSecretReference,
  repoSecretName,
  type SecureFoundationRepoSecretKind,
  type SecureFoundationRepoSecretUse,
  type SecureFoundationWorkflowEvent,
} from "@codeden/contracts";
import { expressionRanges, indentOf, MAX_EXPRESSION } from "./expressions";

/**
 * Reading a project's workflow files for the repository secrets and variables they use
 * (`secrets.NAME`, `vars.NAME`). The files are text and nothing more: no YAML is loaded, no
 * tag is resolved, nothing of the project runs. The scan is tolerant on purpose, since it only
 * has to find names: it follows indentation for the events of `on:` and the jobs of `jobs:`,
 * and looks for references where GitHub evaluates expressions (`${{ … }}` and `if:`), outside
 * the strings quoted inside them. Junk gives fewer names, never an error.
 */

export interface WorkflowFile {
  /** The file's name inside `.github/workflows/`. */
  name: string;
  text: string;
}

export interface WorkflowScan {
  /** Every name the files reference, secrets first, each with where it is used. */
  references: RepoSecretReference[];
  /** Jobs that hand all secrets to a workflow they call (`secrets: inherit`). */
  inherits: Array<{ workflow: string; job: string }>;
  /** References whose name GitHub wouldn't accept (odd characters): counted, never shown. */
  refused: number;
}

const MAX_LINES = 20_000;
const MAX_ITEMS = 60;
const MAX_USES = 20;
const MAX_JOBS = 40;
const MAX_INHERITS = 20;

/** `key:` at the start of a line's content, the key quoted or not, with what follows it. */
const KEY = /^(["']?)([A-Za-z_][A-Za-z0-9_-]{0,99})\1[ \t]*:(.*)$/;

/** The sub-keys of an event that narrow it to some branches, tags or paths. */
const FILTERS = new Set([
  "branches",
  "branches-ignore",
  "paths",
  "paths-ignore",
  "tags",
  "tags-ignore",
]);

/** GitHub's events, for the one-line forms of `on:` where other words can stand beside them. */
const EVENTS = new Set(
  "branch_protection_rule check_run check_suite create delete deployment deployment_status discussion discussion_comment fork gollum issue_comment issues label merge_group milestone page_build public pull_request pull_request_review pull_request_review_comment pull_request_target push registry_package release repository_dispatch schedule status watch workflow_call workflow_dispatch workflow_run".split(
    " ",
  ),
);

/**
 * `secrets.NAME`, `secrets['NAME']`, `secrets["NAME"]` and the same for `vars`, not as the tail
 * of a longer name (`steps.x.outputs.secrets.y`, `mysecrets.y`).
 */
const REFERENCE =
  /(?<![A-Za-z0-9_.-])(secrets|vars)[ \t]*(?:\.[ \t]*([A-Za-z_][A-Za-z0-9_-]{0,199})|\[[ \t]*(?:'([^'\n]{0,200})'|"([^"\n]{0,200})")[ \t]*\])/gi;

/** `contains(<something>, '@name')` in a condition, with the `!` in front of it when negated. */
const MENTIONED = /(!\s*)?contains\([^,()']{1,300},\s*'(@[A-Za-z0-9][A-Za-z0-9-]{0,38})'\s*\)/g;

const isWord = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9]/.test(ch);

/**
 * A line without its YAML comment: from a `#` at the start or after white space, outside
 * quotes. A quote only opens at the start of a word, so the apostrophe of "don't" opens none.
 */
export function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (quote === '"' && ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if ((ch === '"' || ch === "'") && !isWord(line[i - 1])) {
      quote = ch;
    } else if (ch === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * `@claude` when a job's condition lets it run only where something mentions that name: every
 * alternative of the condition has to test for the mention, none of the tests may be negated
 * (`!contains(…)` runs where the mention is absent), and no group may be (`!( … )`). Anything
 * else gives null, and the job is described by its events.
 */
function mentionOf(condition: string | undefined): string | null {
  if (!condition || /!\s*\(/.test(condition)) return null;
  let found: string | null = null;
  // Every alternative has to ask for the mention: `… || github.event_name == 'push'` doesn't.
  for (const alternative of condition.split("||")) {
    const tests = [...alternative.matchAll(MENTIONED)];
    if (tests.length === 0) return null;
    for (const test of tests) {
      if (test[1] || (found !== null && found !== test[2])) return null;
      found = test[2] as string;
    }
  }
  return found;
}

interface Structure {
  events: SecureFoundationWorkflowEvent[];
  /** The job each line belongs to; null outside a job. */
  jobAt: Array<string | null>;
  /** Each job's own `if:`, with its continuation lines. */
  conditions: Map<string, string>;
  inherits: string[];
}

/** The events of `on:` and the jobs of `jobs:`, by indentation. */
function structureOf(lines: string[]): Structure {
  const events: SecureFoundationWorkflowEvent[] = [];
  const jobAt: Array<string | null> = [];
  const conditions = new Map<string, string>();
  const inherits: string[] = [];
  const addEvent = (name: string) => {
    let event = events.find((e) => e.name === name);
    if (!event && events.length < 40) {
      event = { name, filtered: false };
      events.push(event);
    }
    return event ?? null;
  };
  let section: string | null = null;
  /** The indentation of the section's own entries (the events, the jobs). */
  let entries = -1;
  let event: SecureFoundationWorkflowEvent | null = null;
  let job: string | null = null;
  /** The indentation of the current job's own keys. */
  let keys = -1;
  /** The job whose `if:` the following deeper lines continue. */
  let continuing: string | null = null;
  for (const [i, line] of lines.entries()) {
    const text = line.trim();
    if (!text) {
      jobAt[i] = section === "jobs" ? job : null;
      continue;
    }
    const indent = indentOf(line);
    if (indent === 0) {
      const top = KEY.exec(text);
      section = top ? (top[2] as string).toLowerCase() : null;
      entries = -1;
      event = null;
      job = null;
      keys = -1;
      continuing = null;
      if (section === "on") {
        for (const word of (top?.[3] ?? "").match(/[a-z_]+/g) ?? []) {
          if (EVENTS.has(word)) addEvent(word);
        }
      }
      jobAt[i] = null;
      continue;
    }
    if (entries < 0) entries = indent;
    if (section === "on") {
      if (indent === entries) {
        const named = /^(?:-[ \t]*)?(["']?)([a-z_]{1,60})\1[ \t]*:?/.exec(text);
        event = named ? addEvent(named[2] as string) : null;
      } else if (indent > entries && event) {
        const sub = KEY.exec(text);
        if (sub && FILTERS.has(sub[2] as string)) event.filtered = true;
      }
    } else if (section === "jobs") {
      if (indent <= entries) {
        const named = indent === entries ? KEY.exec(text) : null;
        job = named ? (named[2] as string) : null;
        keys = -1;
        continuing = null;
      } else if (job) {
        if (keys < 0) keys = indent;
        if (indent <= keys) {
          continuing = null;
          const key = indent === keys ? KEY.exec(text) : null;
          if (key?.[2] === "if") {
            conditions.set(job, key[3] as string);
            continuing = job;
          } else if (
            key?.[2] === "secrets" &&
            /^[ \t]*["']?inherit["']?[ \t]*$/i.test(key[3] as string) &&
            !inherits.includes(job)
          ) {
            inherits.push(job);
          }
        } else if (continuing) {
          const so = conditions.get(continuing) ?? "";
          if (so.length < MAX_EXPRESSION) conditions.set(continuing, `${so}\n${text}`);
        }
      }
    }
    jobAt[i] = section === "jobs" ? job : null;
  }
  return { events, jobAt, conditions, inherits };
}

interface FileScan {
  /** `secret:NAME` or `variable:NAME` to where this file uses it. */
  uses: Map<string, SecureFoundationRepoSecretUse>;
  inherits: string[];
  refused: number;
}

/** One workflow file. */
function scanFile(file: WorkflowFile): FileScan {
  const lines = file.text.split(/\r?\n/, MAX_LINES).map(stripComment);
  const { events, jobAt, conditions, inherits } = structureOf(lines);
  const starts: number[] = [];
  let length = 0;
  for (const line of lines) {
    starts.push(length);
    length += line.length + 1;
  }
  const body = lines.join("\n");
  const jobsOf = new Map<string, { jobs: string[]; whole: boolean }>();
  let refused = 0;
  /** The line of the reference at hand: the ranges come in order, so it only moves forward. */
  let line = 0;
  const masked = body.split("");
  const ranges = expressionRanges(body, lines, starts, masked);
  const text = masked.join("");
  for (const [from, to] of ranges) {
    for (const match of text.slice(from, to).matchAll(REFERENCE)) {
      const at = from + (match.index ?? 0);
      const raw = match[2] ?? match[3] ?? match[4] ?? "";
      const name = repoSecretName(raw);
      if (!name) {
        if (!raw.toUpperCase().startsWith("GITHUB_")) refused++;
        continue;
      }
      const kind: SecureFoundationRepoSecretKind =
        (match[1] as string).toLowerCase() === "secrets" ? "secret" : "variable";
      while (line + 1 < starts.length && (starts[line + 1] as number) <= at) line++;
      const key = `${kind}:${name}`;
      const entry = jobsOf.get(key) ?? { jobs: [], whole: false };
      const job = jobAt[line] ?? null;
      if (job === null) entry.whole = true;
      else if (!entry.jobs.includes(job) && entry.jobs.length < MAX_JOBS) entry.jobs.push(job);
      jobsOf.set(key, entry);
    }
  }
  const uses = new Map<string, SecureFoundationRepoSecretUse>();
  for (const [key, { jobs, whole }] of jobsOf) {
    const mentions = jobs.map((job) => mentionOf(conditions.get(job)));
    const mention =
      !whole && mentions.length > 0 && mentions.every((m) => m !== null && m === mentions[0])
        ? (mentions[0] as string)
        : null;
    uses.set(key, { workflow: file.name, jobs: whole ? [] : jobs, events, mention });
  }
  return { uses, inherits, refused };
}

/** Every name the workflow files reference, with where each is used. */
export function scanWorkflows(files: WorkflowFile[]): WorkflowScan {
  const byKey = new Map<string, RepoSecretReference>();
  const inherits: WorkflowScan["inherits"] = [];
  let refused = 0;
  for (const file of files) {
    const scan = scanFile(file);
    refused += scan.refused;
    for (const job of scan.inherits) {
      if (inherits.length < MAX_INHERITS) inherits.push({ workflow: file.name, job });
    }
    for (const [key, use] of scan.uses) {
      const [kind, name] = key.split(":") as [SecureFoundationRepoSecretKind, string];
      const reference = byKey.get(key) ?? { kind, name, uses: [] };
      if (reference.uses.length < MAX_USES) reference.uses.push(use);
      byKey.set(key, reference);
    }
  }
  const references = [...byKey.values()]
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "secret" ? -1 : 1,
    )
    .slice(0, MAX_ITEMS);
  return { references, inherits, refused };
}
