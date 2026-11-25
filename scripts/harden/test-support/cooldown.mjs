// GitHub as the cooldown scripts see it, for their tests: a folder of JSON answers that
// stub-gh-cooldown.sh serves as `gh`, and a scratch repository shaped like a fork with a sync.
// Nothing here touches this checkout, GitHub or the clock.
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_ENV, repository, sh } from "./scratch.mjs";

const STUB = fileURLToPath(new URL("./stub-gh-cooldown.sh", import.meta.url));
export const REPO = "example/example-harden";
export const script = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));

/** `2026-11-23T14:55:00Z` for a day of November 2026 and a time of day, as GitHub writes it. */
export const at = (day, time = "12:00") => `2026-11-${String(day).padStart(2, "0")}T${time}:00Z`;

/** The stub answers with `jq`, as `gh --jq` does with its own. */
function needsJq() {
  if (sh(tmpdir(), "/bin/sh", ["-c", "command -v jq"]).code !== 0) {
    throw new Error(
      "The cooldown tests need `jq` on PATH: their stand-in for `gh` applies each call's --jq filter with it. Install jq (GitHub's runners and macOS 15 and later have it).",
    );
  }
}

/** The answers of a GitHub repository, and a PATH that has `gh` (the stub) first. */
export function github() {
  needsJq();
  const state = mkdtempSync(join(tmpdir(), "codeharden-cooldown-gh-"));
  const bin = mkdtempSync(join(tmpdir(), "codeharden-cooldown-bin-"));
  copyFileSync(STUB, join(bin, "gh"));
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(state, "log"), "");
  const put = (file, value) => {
    mkdirSync(dirname(join(state, file)), { recursive: true });
    writeFileSync(join(state, file), JSON.stringify(value));
  };
  const read = (file) =>
    existsSync(join(state, file)) ? readFileSync(join(state, file), "utf8") : "";
  const runs = [];
  const gh = {
    env: { PATH: `${bin}:${process.env.PATH}`, GH_STATE: state, SYNC_COOLDOWN_REPO: REPO },
    /** A pull request. `labels` are the ones it has now; `merged` is the merge's time. */
    pull(
      number,
      {
        head,
        ref = "sync/2026-11-23",
        labels = [],
        merged = null,
        base = "harden",
        repo = REPO,
        mergeCommit = null,
      },
    ) {
      const pr = {
        number,
        state: merged ? "closed" : "open",
        merged_at: merged,
        merge_commit_sha: mergeCommit,
        head: { sha: head, ref, repo: { full_name: repo } },
        base: { ref: base },
        labels: labels.map((name) => ({ name })),
      };
      put(`pulls/${number}.json`, pr);
      return pr;
    },
    /**
     * The label events of a pull request: `[time, "labeled" | "unlabeled", label]`, oldest
     * first, after as many `committed` events as the pull request has commits.
     */
    labelEvents(number, events, commits = 1) {
      put(`timeline/${number}.json`, [
        ...Array.from({ length: commits }, () => ({ event: "committed", sha: "0".repeat(40) })),
        ...events.map(([created_at, event, name]) => ({ event, created_at, label: { name } })),
        { event: "commented", created_at: at(1) },
      ]);
    },
    /** The pushes to a branch: `[time, commit, type = "push"]`, newest first. */
    pushes(branch, rows) {
      put(
        `activity/${branch.replaceAll("/", "__")}.json`,
        rows.map(([timestamp, after, activity_type = "push"]) => ({
          timestamp,
          after,
          activity_type,
        })),
      );
    },
    /** The pull requests GitHub ties to a commit of the default branch. */
    pullsOfCommit(sha, pulls) {
      put(`commit-pulls/${sha}.json`, pulls);
    },
    closedPulls: (pulls) => put("closed-pulls.json", pulls),
    openPulls: (pulls) => put("open-pulls.json", pulls),
    /** A commit GitHub doesn't have: a merge made here and not pushed. */
    notPushed: (sha) => writeFileSync(join(state, "not-pushed"), `${sha}\n`),
    /**
     * A run of the waiver workflow. By default one that is a waiver: successful, on the
     * working branch, approved by the owner in the waiver environment.
     */
    waiverRun({
      upstream,
      commit,
      pullRequest = "none",
      started,
      conclusion = "success",
      branch = "harden",
      approvedBy = "example",
      environment = "sync-waiver",
      approval = "approved",
      title,
    }) {
      const id = 9000 + runs.length;
      runs.unshift({
        id,
        run_started_at: started,
        head_branch: branch,
        conclusion,
        html_url: `https://github.example/runs/${id}`,
        display_title:
          title ??
          `Waive sync cooldown: upstream ${upstream}, pull request ${pullRequest}, commit ${commit}`,
      });
      put("waiver-runs.json", { total_count: runs.length, workflow_runs: runs });
      put(
        `approvals/${id}.json`,
        approvedBy
          ? [
              {
                state: approval,
                user: { login: approvedBy },
                environments: [{ name: environment }],
              },
            ]
          : [],
      );
      return id;
    },
    environment(value, policies) {
      put("environment.json", value);
      if (policies) put("branch-policies.json", { branch_policies: policies });
    },
    /** Calls that fail as in an outage: patterns matched against `<METHOD> <path>`. */
    fail: (...patterns) => writeFileSync(join(state, "fail"), `${patterns.join("\n")}\n`),
    calls: () => read("log").split("\n").filter(Boolean),
    /** The statuses written, oldest first: `{ sha, state, context, description, target_url }`. */
    posted: () =>
      read("posted")
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ sha: line.slice(0, 40), ...JSON.parse(line.slice(41)) })),
  };
  return gh;
}

/**
 * A PATH with the tools the scripts use and no `gh` at all, wherever this machine keeps one.
 */
export function pathWithoutGh() {
  const bin = mkdtempSync(join(tmpdir(), "codeharden-no-gh-bin-"));
  const tools =
    "bash sh git sed awk tr head tail cut cat cp rm mkdir mktemp date dirname grep sort env";
  for (const tool of tools.split(" ")) {
    const found = sh(tmpdir(), "/bin/sh", ["-c", `command -v ${tool}`]).out;
    if (found.startsWith("/")) symlinkSync(found, join(bin, tool));
  }
  return bin;
}

/**
 * A fork with one release behind it: `up` is upstream's branch, `harden` the working branch
 * with a commit of its own, and VERSION, the changelog and state/upstream-base as the release
 * left them.
 */
export function fork(branch = "harden") {
  const repo = repository("codeharden-cooldown-test-", [`--initial-branch=${branch}`]);
  const { dir, git, commit } = repo;
  commit("upstream-1.txt", "feat: upstream one");
  git("branch", "up");
  mkdirSync(join(dir, "state"));
  writeFileSync(join(dir, "VERSION"), "2026.1122.2006\n");
  writeFileSync(join(dir, "state", "upstream-base"), `${git("rev-parse", "HEAD")}\n`);
  writeFileSync(
    join(dir, "CODEHARDEN-CHANGELOG.md"),
    "# CodeHarden releases\n\n## 2026.1122.2006 — 2026-11-22 20:06\n\n### codeharden\n- docs: introduce CodeHarden\n",
  );
  git("add", ".");
  git("commit", "--quiet", "-m", "release: 2026.1122.2006 (upstream 00000000)");
  git("tag", "-a", "v2026.1122.2006", "-m", "CodeHarden 2026.1122.2006");
  commit("own.txt", "feat: our own change");
  /** Upstream moves on by one commit. Returns it. */
  const upstreamCommit = (file = "upstream-2.txt", subject = "fix: upstream two") => {
    git("checkout", "--quiet", "up");
    const sha = commit(file, subject);
    git("checkout", "--quiet", branch);
    return sha;
  };
  /** A sync branch: upstream's tip with the working branch merged into it. Returns its head. */
  const syncBranch = (name = "sync/2026-11-23") => {
    git("checkout", "--quiet", "-b", name, "up");
    git("merge", "--quiet", "--no-ff", branch, "-m", `Merge ${branch} into upstream`);
    const head = git("rev-parse", "HEAD");
    git("checkout", "--quiet", branch);
    return head;
  };
  /** Merges a branch the way GitHub's merge button does. Returns the merge commit. */
  const merge = (name, number = 7) => {
    git(
      "merge",
      "--quiet",
      "--no-ff",
      name,
      "-m",
      `Merge pull request #${number} from example/${name}`,
    );
    return git("rev-parse", "HEAD");
  };
  const run = (name, args, env = {}) => sh(dir, "bash", [script(name), ...args], env);
  return { ...repo, branch, upstreamCommit, syncBranch, merge, run, env: BASE_ENV };
}

/** The verdict's `key: value` lines, as an object. */
export function verdict(out) {
  return Object.fromEntries(
    out
      .split("\n")
      .map((line) => /^([a-z]+):(?: (.*))?$/.exec(line))
      .filter(Boolean)
      .map(([, key, value]) => [key, value ?? ""]),
  );
}
