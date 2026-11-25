import { devNull } from "node:os";
import { join } from "node:path";
import {
  HARDEN_PRODUCT_NAME,
  type SecureFoundationModule,
  SecureFoundationModuleName,
} from "@codeden/contracts";
import { ServiceError } from "../errors";
import type { Exec, ExecResult } from "../exec";
import { redactUrls } from "../projects/detect";

/**
 * Fetching the Secure Foundation template and writing it out as a new repository. Everything
 * here is git run without a shell: the server never runs a file of the template.
 */

/** The one repository that is ever fetched: the build's template, never a request's. */
export interface TemplateSource {
  /** `owner/repo`, for display. */
  repository: string;
  branch: string;
  /** The HTTPS clone URL (a local path in tests). */
  url: string;
}

export interface FetchedTemplate {
  /** The temporary bare repository that holds the fetched commit. */
  gitDir: string;
  commit: string;
  /** ISO time of the commit. */
  committedAt: string;
}

const FETCH_TIMEOUT_MS = 10 * 60_000;
const LOCAL_TIMEOUT_MS = 120_000;

/**
 * Options for every git call: no stored or asked-for credentials (the template is public), no
 * hooks, no submodules, no helper programs named by a URL.
 */
const SAFE = [
  "-c",
  "credential.helper=",
  "-c",
  `core.hooksPath=${devNull}`,
  "-c",
  "core.fsmonitor=false",
  "-c",
  "protocol.ext.allow=never",
  "-c",
  "submodule.recurse=false",
  "-c",
  "fetch.recurseSubmodules=false",
];

/** Never prompt: a fetch that would ask for a password fails instead. */
const gitEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
});

async function git(
  exec: Exec,
  cwd: string,
  args: string[],
  timeoutMs = LOCAL_TIMEOUT_MS,
): Promise<ExecResult> {
  const result = await exec("git", [...SAFE, ...args], { cwd, timeoutMs, env: gitEnv() });
  if (result.notFound) throw new ServiceError(503, "git_missing", "git is not installed");
  return result;
}

/** The last lines of git's complaint, without credentials. */
function failure(result: ExecResult, fallback: string): Error {
  const detail = redactUrls(result.stderr.trim().split("\n").slice(-3).join("\n"));
  return new Error(result.timedOut ? `${fallback} (timed out)` : detail || fallback);
}

async function ok(exec: Exec, cwd: string, args: string[], what: string, timeoutMs?: number) {
  const result = await git(exec, cwd, args, timeoutMs);
  if (result.code !== 0) throw failure(result, what);
  return result.stdout;
}

/**
 * Fetch the latest commit of the template's branch into a new bare repository in `workDir`
 * (an empty temporary folder): one commit, no tags, no submodules, nothing checked out.
 */
export async function fetchTemplate(
  exec: Exec,
  source: TemplateSource,
  workDir: string,
): Promise<FetchedTemplate> {
  const gitDir = join(workDir, "template.git");
  await ok(exec, workDir, ["init", "--quiet", "--bare", "--template=", gitDir], "git init failed");
  await ok(
    exec,
    gitDir,
    [
      "fetch",
      "--quiet",
      "--depth=1",
      "--no-tags",
      "--no-recurse-submodules",
      "--",
      source.url,
      `refs/heads/${source.branch}`,
    ],
    "The template could not be fetched",
    FETCH_TIMEOUT_MS,
  );
  const out = await ok(
    exec,
    gitDir,
    ["log", "-1", "--format=%H%n%cI", "FETCH_HEAD"],
    "The template's commit could not be read",
  );
  const [commit = "", date = ""] = out.trim().split("\n");
  const time = Date.parse(date);
  if (!/^[0-9a-f]{40}$/.test(commit) || Number.isNaN(time)) {
    throw new Error("The template's commit could not be read");
  }
  return { gitDir, commit, committedAt: new Date(time).toISOString() };
}

const MANIFEST_MAX = 64_000;

/**
 * The content modules of the fetched commit: `templates/modules/<name>/module.json`, read as
 * text from git's objects (no file of the template is written or run). A template without the
 * folder has none; a manifest that can't be read is listed by its name alone.
 */
export async function readModules(
  exec: Exec,
  fetched: FetchedTemplate,
): Promise<SecureFoundationModule[]> {
  const listed = await git(exec, fetched.gitDir, [
    "ls-tree",
    "--name-only",
    `${fetched.commit}:templates/modules`,
  ]);
  if (listed.code !== 0) return [];
  const names = listed.stdout
    .split("\n")
    .map((n) => n.trim())
    .filter((n) => SecureFoundationModuleName.safeParse(n).success);
  const modules: SecureFoundationModule[] = [];
  for (const name of names.slice(0, 20)) {
    const shown = await git(exec, fetched.gitDir, [
      "show",
      `${fetched.commit}:templates/modules/${name}/module.json`,
    ]);
    if (shown.code !== 0) continue;
    let manifest: { title?: unknown; description?: unknown } = {};
    try {
      manifest = JSON.parse(shown.stdout.slice(0, MANIFEST_MAX)) as typeof manifest;
    } catch {
      // Listed by name below.
    }
    const text = (value: unknown, max: number) =>
      typeof value === "string" ? value.trim().slice(0, max) : "";
    modules.push({
      name,
      title: text(manifest.title, 80) || name,
      description: text(manifest.description, 300),
    });
  }
  return modules;
}

/** The identity for the first commit: the person's own, or the product's when git has none. */
async function identityArgs(exec: Exec, dest: string): Promise<string[]> {
  const [name, email] = await Promise.all([
    git(exec, dest, ["config", "user.name"]),
    git(exec, dest, ["config", "user.email"]),
  ]);
  if (name.stdout.trim() && email.stdout.trim()) return [];
  return ["-c", `user.name=${HARDEN_PRODUCT_NAME}`, "-c", "user.email=noreply@localhost"];
}

/**
 * Write the fetched commit's files into `dest` (an empty folder) as a fresh repository: one
 * new initial commit on `main`, no remote, none of the template's history.
 */
export async function writeFreshRepository(
  exec: Exec,
  fetched: FetchedTemplate,
  dest: string,
  message: string,
): Promise<void> {
  await ok(
    exec,
    dest,
    [
      `--git-dir=${fetched.gitDir}`,
      `--work-tree=${dest}`,
      "checkout",
      "-f",
      fetched.commit,
      "--",
      ".",
    ],
    "The template's files could not be written",
  );
  await ok(exec, dest, ["init", "--quiet", "-b", "main", "--template="], "git init failed");
  await ok(exec, dest, ["add", "-A"], "git add failed");
  await ok(
    exec,
    dest,
    [...(await identityArgs(exec, dest)), "commit", "--quiet", "--no-gpg-sign", "-m", message],
    "The first commit could not be made",
  );
}

/**
 * The other repository mode (`SECURE_FOUNDATION_REPOSITORY_MODE` `clone`): an ordinary clone of
 * the template's branch into `dest`, with its history and `origin`. Returns the commit it is at.
 */
export async function writeClone(
  exec: Exec,
  source: TemplateSource,
  dest: string,
): Promise<string> {
  await ok(
    exec,
    dest,
    [
      "clone",
      "--quiet",
      "--no-recurse-submodules",
      "--template=",
      "--branch",
      source.branch,
      "--",
      source.url,
      dest,
    ],
    "The template could not be cloned",
    FETCH_TIMEOUT_MS,
  );
  return (
    await ok(exec, dest, ["rev-parse", "HEAD"], "The clone's commit could not be read")
  ).trim();
}
