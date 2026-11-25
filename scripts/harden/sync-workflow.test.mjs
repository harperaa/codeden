// The sync workflow's protected-paths rule, run as written: the function is cut out of the
// workflow file and run with bash in a scratch repository laid out like the merge job's.
// And the cooldown, as the workflow files state it: the merge job asks the one rule before
// it merges, the release job runs the release script with it, and the report workflow shows
// it without being able to change anything but a status.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { script } from "./test-support/cooldown.mjs";
import {
  D,
  expression,
  jobs,
  permissions,
  runBlocks,
  SCRIPT,
  triggers,
  workflowFile,
} from "./test-support/workflow.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/upstream-sync-merge.yml", import.meta.url),
  "utf8",
);
const snippet =
  /# protected-paths:begin\n([\s\S]*?)# protected-paths:end/.exec(workflow)?.[1] ?? "";
const protectedPaths = /^ {2}PROTECTED_PATHS: (.+)$/m.exec(workflow)?.[1] ?? "";

const ENV = {
  PATH: process.env.PATH,
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "codeharden-sync-test-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: ENV });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const commit = (file, text) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
    git("add", file);
    git("commit", "--quiet", "-m", `change ${file}`);
    return git("rev-parse", "HEAD");
  };
  git("init", "--quiet", "--initial-branch=up");
  commit("app.txt", "one\n");
  git("checkout", "--quiet", "-b", "harden");
  commit("scripts/harden/release.sh", "ours\n");
  git("update-ref", "refs/sync/target", "HEAD");
  /** What the workflow's function prints for a head commit. */
  const touched = (sha) => {
    const result = spawnSync(
      "bash",
      ["-c", `set -euo pipefail\n${snippet}\ntouches_protected "$1"`, "bash", sha],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...ENV, PROTECTED_PATHS: protectedPaths },
      },
    );
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  return { git, commit, touched };
}

describe("the sync workflow's protected paths", () => {
  it("protects this fork's release scripts, by a function the merge job calls before merging", () => {
    expect(protectedPaths.split(" ")).toContain("scripts/harden/");
    expect(snippet).toContain("touches_protected()");
    const check = workflow.indexOf('touches_protected "$head_sha"');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(workflow.indexOf('gh pr merge "$number"'));
  });

  it("lets through a head that is upstream code only, or a clean merge of it", () => {
    const repo = scratch();
    repo.git("checkout", "--quiet", "up");
    const upstream = repo.commit("app.txt", "two\n");
    expect(repo.touched(upstream)).toBe("");
    repo.git("checkout", "--quiet", "-b", "sync/x", "up");
    repo.git("merge", "--quiet", "--no-ff", "harden", "-m", "merge harden");
    expect(repo.touched(repo.git("rev-parse", "HEAD"))).toBe("");
  });

  it("names the protected files an upstream commit adds", () => {
    const repo = scratch();
    repo.git("checkout", "--quiet", "up");
    const upstream = repo.commit("scripts/harden/extra.sh", "theirs\n");
    expect(repo.touched(upstream)).toBe("scripts/harden/extra.sh");
  });

  it("names the protected files a merge commit changes", () => {
    const repo = scratch();
    repo.git("checkout", "--quiet", "up");
    repo.commit("app.txt", "two\n");
    repo.git("checkout", "--quiet", "-b", "sync/x", "up");
    repo.git("merge", "--quiet", "--no-ff", "--no-commit", "harden");
    writeFileSync(
      join(repo.git("rev-parse", "--show-toplevel"), "scripts/harden/release.sh"),
      "changed\n",
    );
    repo.git("add", "-A");
    repo.git("commit", "--quiet", "-m", "merge harden");
    expect(repo.touched(repo.git("rev-parse", "HEAD"))).toBe("scripts/harden/release.sh");
  });
});

/** A constant of the cooldown rule, as scripts/harden/sync-cooldown.sh sets it. */
const constant = (name) =>
  spawnSync("bash", ["-c", `. "${script("sync-cooldown.sh")}"; printf '%s' "$${name}"`], {
    encoding: "utf8",
    env: ENV,
  }).stdout;
const env = (name) => new RegExp(`^ {2}${name}: (.+)$`, "m").exec(workflow)?.[1] ?? "";

describe("the sync workflow and the cooldown", () => {
  const all = jobs(workflow);

  it("merges only on the rule's own yes, asked before anything is merged", () => {
    const merge = all.merge;
    const asked = merge.indexOf(
      'sync-cooldown-report.sh" pull-request "$number" --head "$head_sha"',
    );
    expect(asked).toBeGreaterThan(-1);
    expect(asked).toBeLessThan(merge.indexOf('gh pr merge "$number"'));
    // Exit 1 is a no; anything but exit 0 with "satisfied" or "waived" is not a yes either.
    const after = merge.slice(asked, merge.indexOf("# 5. Upstream code only"));
    expect(after).toContain('if [ "$code" = 1 ]; then');
    expect(after).toContain(
      'if [ "$code" != 0 ] || { [ "$cooldown_state" != "satisfied" ] && [ "$cooldown_state" != "waived" ]; }; then',
    );
    expect(after.match(/continue/g)).toHaveLength(2);
    // The scripts are the working branch's own, never a pull request's.
    expect(merge).toContain(
      `git show "refs/sync/target:${SCRIPT}" > "$RUNNER_TEMP/harden/${D}{script##*/}"`,
    );
    expect(merge).toContain("nothing is merged without the cooldown rule");
  });

  it("keeps the hours and the labels in one place", () => {
    // The workflow has no number of hours of its own, and no second reading of the timeline.
    expect(workflow).not.toContain("DELAY_HOURS");
    expect(runBlocks(workflow)).not.toMatch(/timeline|labeled_at|date -u -d/);
    expect(constant("COOLDOWN_HOURS")).toBe("48");
    expect(env("APPROVED_LABEL")).toBe(constant("APPROVED_LABEL"));
    expect(env("BLOCKING_LABELS").split(" ")).toContain(constant("HOLD_LABEL"));
    expect(env("HEAD_PREFIX")).toBe(constant("SYNC_HEAD_PREFIX"));
    const scripts = env("COOLDOWN_SCRIPTS").split(" ");
    expect(scripts).toEqual([
      "scripts/harden/sync-cooldown.sh",
      "scripts/harden/sync-cooldown-report.sh",
      "scripts/harden/sync-cooldown-release.sh",
    ]);
    for (const file of scripts)
      expect(existsSync(new URL(`../../${file}`, import.meta.url))).toBe(true);
  });

  it("releases with the release script and the rule it asks, from the working branch", () => {
    const release = all.release;
    expect(release).toContain(
      `for script in $RELEASE_SCRIPT $FORK_CONFIG_SCRIPT $COOLDOWN_SCRIPTS; do paths+=("/${SCRIPT}"); done`,
    );
    // The script fetches upstream and finds the last release itself: nothing is handed to it.
    expect(release).toMatch(/^ +bash "\$RELEASE_SCRIPT" --push$/m);
    // The token is given to this repository's URL only, not to upstream's.
    expect(release).toContain(
      `git config "http.${D}{fork_url}.extraheader" "AUTHORIZATION: basic $auth"`,
    );
    expect(release).not.toContain("http.https://github.com/.extraheader");
    expect(release).toContain(expression("GH_TOKEN", "github.token"));
  });

  it("gives each job only what it needs", () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    expect(permissions(all.config)).toBeNull();
    expect(permissions(all.mirror)).toEqual(["contents: write"]);
    expect(permissions(all.merge)).toEqual([
      "contents: write",
      "pull-requests: write",
      "checks: read",
      "actions: read",
      "statuses: write",
    ]);
    expect(permissions(all.release)).toEqual([
      "contents: write",
      "pull-requests: read",
      "actions: read",
    ]);
    expect(workflow).not.toMatch(/^\s*(- )?uses:/m);
  });

  it("never lets a sync change the cooldown's own workflows, or what a release writes, by itself", () => {
    const paths = protectedPaths.split(" ");
    expect(paths).toContain(".github/workflows/sync-cooldown.yml");
    expect(paths).toContain(".github/workflows/sync-waiver.yml");
    expect(paths).toContain(".github/workflows/harden-desktop.yml");
    // Where the last release was and what it contained are read from these.
    expect(paths).toContain("VERSION");
    expect(paths).toContain(env("CHANGELOG_FILE"));
    expect(paths).toContain(`${env("BASE_FILE").split("/")[0]}/`);
  });

  it("names a sync that changes a release's files, as the function the merge job calls", () => {
    const repo = scratch();
    repo.git("checkout", "--quiet", "up");
    repo.commit("VERSION", "2099.0101.0000\n");
    const upstream = repo.commit("state/upstream-base", "moved\n");
    expect(repo.touched(upstream)).toBe("VERSION\nstate/upstream-base");
  });

  it("waits up to two minutes for GitHub to count a status that was just written", () => {
    const merge = all.merge;
    const attempts = /for attempt in ([0-9 ]+); do/.exec(merge)?.[1].trim().split(" ") ?? [];
    const pause = Number(/\n +sleep (\d+)\n +done/.exec(merge)?.[1]);
    expect((attempts.length - 1) * pause).toBe(120);
    expect(merge).toContain('[ "$mergeable" != "null" ] && [ "$state" != "unstable" ] && break');
    // The status is written by the rule's call, which comes before this wait.
    expect(merge.indexOf("sync-cooldown-report.sh")).toBeLessThan(merge.indexOf("for attempt in"));
  });
});

describe("the cooldown report workflow", () => {
  const report = workflowFile("sync-cooldown.yml");
  const all = jobs(report);

  it("runs every hour, on label changes, after a waiver and by hand, from the default branch's file", () => {
    const on = triggers(report);
    expect(on).toMatch(/pull_request_target:\n {4}types: \[labeled, unlabeled\]/);
    expect(on).toMatch(/schedule:\n {4}- cron: "\d+ \* \* \* \*"/);
    expect(on).toMatch(
      /workflow_run:\n {4}workflows: \["Waive sync cooldown"\]\n {4}types: \[completed\]/,
    );
    expect(on).toContain("workflow_dispatch:");
    // `pull_request` would run a pull request's own copy of this file.
    expect(on).not.toMatch(/^\s+(pull_request|push):/m);
  });

  it("can write a status and nothing else, and runs no pull request's code", () => {
    expect(report).toMatch(/^permissions: \{\}$/m);
    expect(Object.keys(all)).toEqual(["report"]);
    expect(permissions(all.report)).toEqual([
      "contents: read",
      "pull-requests: read",
      "actions: read",
      "statuses: write",
    ]);
    expect(report).not.toMatch(/^\s*(- )?uses:/m);
    expect(report).not.toContain("secrets.");
    expect(runBlocks(report)).not.toContain("${{");
    expect(all.report).toContain(expression("PR_NUMBER", "github.event.pull_request.number"));
    expect(all.report).toContain('if [[ ! "$PR_NUMBER" =~ ^[0-9]+$ ]]; then');
  });

  it("names its job differently from the status, so a green job is never read as the cooldown", () => {
    const context = constant("STATUS_CONTEXT");
    expect(context).toBe("Sync cooldown");
    const names = [...report.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1]);
    expect(names).toEqual(["Evaluate"]);
    expect(/^name: (.+)$/m.exec(report)?.[1]).not.toBe(context);
    for (const name of [
      "upstream-sync-merge.yml",
      "sync-waiver.yml",
      "ci.yml",
      "harden-desktop.yml",
    ]) {
      expect(workflowFile(name)).not.toMatch(new RegExp(`^\\s+name: ${context}$`, "m"));
    }
  });

  it("never fails the job on a label event, whatever its step does", () => {
    expect(all.report).toContain(
      `continue-on-error: ${D}{{ github.event_name == 'pull_request_target' }}`,
    );
    // One step, so that this covers all of it.
    expect(all.report.match(/^ {6}- name:/gm)).toHaveLength(1);
  });

  it("answers a label event without failing when GitHub can't be asked, and looks at all on the hourly run", () => {
    const run = runBlocks(report);
    expect(run).toContain('bash "$RUNNER_TEMP/harden/sync-cooldown-report.sh" all\n');
    expect(run).toContain(
      'bash "$RUNNER_TEMP/harden/sync-cooldown-report.sh" pull-request "$PR_NUMBER" || code=$?',
    );
    expect(run).toContain('if [ "$code" != 0 ] && [ "$code" != 1 ]; then');
    expect(run).toContain("::warning::");
  });
});
