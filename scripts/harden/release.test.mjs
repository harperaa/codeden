// release.sh and publish.sh in a scratch git repository: nothing here touches this checkout,
// a remote, GitHub or npm. `gh` is a stub (test-support/cooldown.mjs).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { at, fork, github, pathWithoutGh, REPO } from "./test-support/cooldown.mjs";

const RELEASE = fileURLToPath(new URL("./release.sh", import.meta.url));
const PUBLISH = fileURLToPath(new URL("./publish.sh", import.meta.url));
const NOW = "2026.1123.0905 2026-11-23 09:05";
const ENV = {
  PATH: process.env.PATH,
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

function sh(cwd, command, args, env = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...ENV, ...env } });
  return { code: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
}

/** A repository with an upstream branch (`up`) and a fork branch that made one release. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "codeharden-release-test-"));
  const git = (...args) => {
    const result = sh(dir, "git", args);
    if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.err}`);
    return result.out;
  };
  const commit = (file, subject) => {
    writeFileSync(join(dir, file), `${subject}\n`);
    git("add", file);
    git("commit", "--quiet", "-m", subject);
  };
  git("init", "--quiet", "--initial-branch=harden");
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
  const gh = github();
  const release = (args = [], env = {}) =>
    sh(dir, "bash", [RELEASE, "--upstream-ref", "up", ...args], {
      RELEASE_NOW: NOW,
      ...gh.env,
      GITHUB_REPOSITORY: REPO,
      // Upstream is this repository's own `up` branch: no network.
      UPSTREAM_URL: dir,
      UPSTREAM_BRANCH: "up",
      ...env,
    });
  const read = (file) => readFileSync(join(dir, file), "utf8");
  return { dir, git, commit, release, read, gh };
}

/**
 * Our own change, then an upstream change merged in by sync pull request #7, which had been
 * approved for two days when it was merged.
 */
function withChanges(repo) {
  repo.commit("own.txt", "feat: our own change");
  repo.git("checkout", "--quiet", "up");
  repo.commit("upstream-2.txt", "fix: upstream two");
  repo.git("checkout", "--quiet", "harden");
  repo.git("merge", "--quiet", "--no-ff", "up", "-m", "Merge upstream");
  const upstream = repo.git("rev-parse", "up");
  const mergeCommit = repo.git("rev-parse", "HEAD");
  const pr = repo.gh.pull(7, {
    head: upstream,
    ref: "sync/2026-11-21",
    labels: ["sync-approved"],
    merged: at(23, "13:00"),
    mergeCommit,
  });
  repo.gh.labelEvents(7, [[at(21, "12:00"), "labeled", "sync-approved"]]);
  repo.gh.pushes("sync/2026-11-21", [[at(21, "11:00"), upstream, "branch_creation"]]);
  repo.gh.closedPulls([pr]);
  return upstream;
}

describe("release.sh", () => {
  it("writes VERSION, the changelog entry and the upstream base, commits and tags", () => {
    const repo = scratch();
    const upstream = withChanges(repo);
    const result = repo.release();
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(repo.read("VERSION")).toBe("2026.1123.0905\n");
    expect(repo.read("state/upstream-base")).toBe(`${upstream}\n`);
    expect(repo.read("CODEHARDEN-CHANGELOG.md")).toBe(
      [
        "# CodeHarden releases",
        "",
        "## 2026.1123.0905 — 2026-11-23 09:05",
        "",
        "### upstream (leonvanzyl/codeden)",
        "- fix: upstream two",
        "",
        "### codeharden",
        "- feat: our own change",
        "",
        "## 2026.1122.2006 — 2026-11-22 20:06",
        "",
        "### codeharden",
        "- docs: introduce CodeHarden",
        "",
      ].join("\n"),
    );
    const short = upstream.slice(0, 8);
    expect(repo.git("log", "-1", "--format=%s")).toBe(
      `release: 2026.1123.0905 (upstream ${short})`,
    );
    expect(
      repo.git("show", "--stat", "--format=", "HEAD").split("\n").slice(0, 3).join(" "),
    ).toMatch(/CODEHARDEN-CHANGELOG\.md.*VERSION.*state\/upstream-base/);
    expect(repo.git("cat-file", "-t", "v2026.1123.0905")).toBe("tag");
    expect(repo.git("tag", "-l", "--format=%(contents:subject)", "v2026.1123.0905")).toBe(
      `CodeHarden 2026.1123.0905 (upstream ${short})`,
    );
    expect(repo.git("rev-parse", "v2026.1123.0905^{commit}")).toBe(repo.git("rev-parse", "HEAD"));
    expect(repo.git("status", "--porcelain")).toBe("");
    expect(result.out).toContain("Not pushed.");
    expect(result.out).toContain(
      `Sync cooldown: upstream ${short} came in through pull request #7 (sync/2026-11-21), merged 2026-11-23 13:00 UTC, 49 hours after sync-approved was applied (2026-11-21 12:00 UTC).`,
    );
  });

  it("lists only our own commits when upstream didn't move, and says so when nothing changed", () => {
    const repo = scratch();
    repo.commit("own.txt", "fix: only ours");
    const own = repo.release();
    expect(own.err).toBe("");
    expect(own.code).toBe(0);
    expect(own.out).toContain(
      "Sync cooldown: no upstream commits arrived since the last release (0 merged pull requests looked at).",
    );
    const first = repo.read("CODEHARDEN-CHANGELOG.md");
    expect(first).toContain(
      "## 2026.1123.0905 — 2026-11-23 09:05\n\n### codeharden\n- fix: only ours\n\n## ",
    );
    expect(first).not.toContain("### upstream");

    const again = repo.release([], { RELEASE_NOW: "2026.1123.0906 2026-11-23 09:06" });
    expect(again.code).toBe(0);
    expect(repo.read("CODEHARDEN-CHANGELOG.md")).toContain(
      "## 2026.1123.0906 — 2026-11-23 09:06\n\n- rebuild only (upstream base or dependency refresh)\n\n## 2026.1123.0905",
    );
  });

  it("changes nothing on a dry run", () => {
    const repo = scratch();
    withChanges(repo);
    const head = repo.git("rev-parse", "HEAD");
    const result = repo.release(["--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Dry run: nothing is written");
    expect(result.out).toContain("## 2026.1123.0905 — 2026-11-23 09:05");
    expect(result.out).toContain("- feat: our own change");
    expect(repo.git("rev-parse", "HEAD")).toBe(head);
    expect(repo.read("VERSION")).toBe("2026.1122.2006\n");
    expect(repo.git("tag", "-l")).toBe("v2026.1122.2006");
    expect(repo.git("status", "--porcelain")).toBe("");
  });

  it("refuses when the tag already exists, and changes nothing", () => {
    const repo = scratch();
    repo.commit("own.txt", "fix: only ours");
    expect(repo.release().code).toBe(0);
    const head = repo.git("rev-parse", "HEAD");
    repo.commit("more.txt", "fix: one more");
    const after = repo.git("rev-parse", "HEAD");
    const second = repo.release();
    expect(second.code).toBe(1);
    expect(second.err).toContain("tag v2026.1123.0905 already exists");
    expect(repo.git("rev-parse", "HEAD")).toBe(after);
    expect(repo.git("rev-parse", "v2026.1123.0905^{commit}")).toBe(head);
    expect(repo.read("VERSION")).toBe("2026.1123.0905\n");
  });

  it("refuses with changes to tracked files, a bad clock or no remote to push to", () => {
    const dirty = scratch();
    writeFileSync(join(dirty.dir, "upstream-1.txt"), "edited\n");
    expect(dirty.release().err).toContain("tracked files have changes");

    const badClock = scratch();
    expect(badClock.release([], { RELEASE_NOW: "2026.105.518 2026-01-05 05:18" }).err).toContain(
      "is not a version",
    );
    expect(badClock.release(["--push"]).err).toContain("no remote named origin");
  });
});

describe("release.sh and where the last release was", () => {
  /** Upstream moved and was merged by hand, with no pull request. Returns the upstream commit. */
  function mergedByHand(repo) {
    repo.git("checkout", "--quiet", "up");
    repo.commit("upstream-2.txt", "fix: upstream two");
    repo.git("checkout", "--quiet", "harden");
    repo.git("merge", "--quiet", "--no-ff", "up", "-m", "Merge upstream by hand");
    return repo.git("rev-parse", "up");
  }

  it("does not read the last upstream base from the working tree: a commit that moves it is refused", () => {
    const repo = scratch();
    const before = repo.read("state/upstream-base").trim();
    const upstream = mergedByHand(repo);
    // The file now names what the branch contains: on its word there would be nothing to ask.
    writeFileSync(join(repo.dir, "state", "upstream-base"), `${upstream}\n`);
    repo.git("commit", "--quiet", "-am", "chore: move the upstream base");
    const result = repo.release();
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      `state/upstream-base was changed since the last release (v2026.1122.2006 wrote ${before})`,
    );
    // Put back, the merge is seen for what it is.
    repo.git("checkout", "v2026.1122.2006", "--", "state/upstream-base");
    repo.git("commit", "--quiet", "-m", "chore: put the upstream base back");
    const asked = repo.release();
    expect(asked.code).toBe(1);
    expect(asked.err).toContain("which is not the merge of a pull request into harden");
  });

  it("refuses when the base file of the last release is not a commit, or VERSION was changed", () => {
    const badBase = scratch();
    writeFileSync(join(badBase.dir, "state", "upstream-base"), "not-a-commit\n");
    badBase.git("commit", "--quiet", "-am", "break the base");
    expect(badBase.release().err).toContain(
      "state/upstream-base was changed since the last release",
    );

    const version = scratch();
    writeFileSync(join(version.dir, "VERSION"), "2026.1123.0800\n");
    version.git("commit", "--quiet", "-am", "chore: bump");
    const result = version.release();
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      "VERSION says 2026.1123.0800, but the last release this checkout has on this branch is v2026.1122.2006",
    );

    const none = scratch();
    none.git("tag", "-d", "v2026.1122.2006");
    expect(none.release().err).toContain("no release tag of this checkout is on this branch");
  });

  it("takes the last release from the remote's tags: a release made up here and not pushed is not one", () => {
    const repo = scratch();
    const remote = mkdtempSync(join(tmpdir(), "codeharden-release-remote-"));
    sh(remote, "git", ["init", "--quiet", "--bare"]);
    repo.git("remote", "add", "origin", remote);
    repo.git("push", "--quiet", "origin", "harden", "v2026.1122.2006");
    const upstream = mergedByHand(repo);
    // What a release writes, written by hand, with a tag of its own.
    writeFileSync(join(repo.dir, "state", "upstream-base"), `${upstream}\n`);
    writeFileSync(join(repo.dir, "VERSION"), "2026.1123.0800\n");
    repo.git("commit", "--quiet", "-am", "release: 2026.1123.0800 (upstream by hand)");
    repo.git("tag", "-a", "v2026.1123.0800", "-m", "CodeHarden 2026.1123.0800");
    const result = repo.release();
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      "VERSION says 2026.1123.0800, but the last release origin has on this branch is v2026.1122.2006",
    );
    // Without the remote the same tag would have been the last release.
    repo.git("remote", "remove", "origin");
    expect(repo.release().err).not.toContain("VERSION says");
  });

  it("checks a named upstream ref against the upstream itself, and fetches it when none is named", () => {
    const repo = scratch();
    const older = repo.git("rev-parse", "up");
    const upstream = mergedByHand(repo);
    const run = (args, env = {}) =>
      sh(repo.dir, "bash", [RELEASE, ...args], {
        RELEASE_NOW: NOW,
        ...repo.gh.env,
        GITHUB_REPOSITORY: REPO,
        UPSTREAM_URL: repo.dir,
        UPSTREAM_BRANCH: "up",
        ...env,
      });
    // An older upstream commit as "upstream" would hide the merge.
    const stale = run(["--upstream-ref", older]);
    expect(stale.code).toBe(1);
    expect(stale.err).toContain(`${older} is not where up of ${repo.dir} is now (${upstream})`);
    const unreachable = run(["--upstream-ref", "up"], { UPSTREAM_URL: join(repo.dir, "nowhere") });
    expect(unreachable.code).toBe(1);
    expect(unreachable.err).toContain("so up can't be checked against it");
    // With none named it is fetched, and the merge is asked about.
    const fetched = run([]);
    expect(fetched.err).toContain("which is not the merge of a pull request into harden");
    expect(repo.git("rev-parse", "refs/sync/upstream")).toBe(upstream);
  });
});

const SYNC = "sync/2026-11-23";

/** The release of a fork made with test-support/cooldown.mjs, against a stub GitHub. */
function releaser(repo, gh, branch = "harden") {
  return (args = [], env = {}) =>
    repo.run("release.sh", ["--upstream-ref", "up", ...args], {
      RELEASE_NOW: NOW,
      ...gh.env,
      GITHUB_REPOSITORY: REPO,
      HARDEN_BRANCH: branch,
      UPSTREAM_URL: repo.dir,
      UPSTREAM_BRANCH: "up",
      ...env,
    });
}

/**
 * A fork whose sync pull request #7 was merged on the 23rd at 13:00. By default it had been
 * approved for 49 hours by then; `approved` moves the label, `events` and `pushes` replace
 * its history.
 */
function merged({ branch = "harden", approved = at(21, "12:00"), events, pushes } = {}) {
  const repo = fork(branch);
  const gh = github();
  const upstream = repo.upstreamCommit();
  const head = repo.syncBranch(SYNC);
  const mergeCommit = repo.merge(SYNC, 7);
  const pr = gh.pull(7, { head, ref: SYNC, merged: at(23, "13:00"), mergeCommit, base: branch });
  gh.labelEvents(7, events ?? [[approved, "labeled", "sync-approved"]]);
  gh.pushes(SYNC, pushes?.(head) ?? [[at(21, "11:00"), head, "branch_creation"]]);
  gh.closedPulls([pr]);
  const read = (file) => readFileSync(join(repo.dir, file), "utf8");
  /** Nothing was written, committed or tagged. */
  const untouched = () => {
    expect(repo.git("rev-parse", "HEAD")).toBe(mergeCommit);
    expect(read("VERSION")).toBe("2026.1122.2006\n");
    expect(repo.git("tag", "-l")).toBe("v2026.1122.2006");
    expect(repo.git("status", "--porcelain")).toBe("");
  };
  return {
    repo,
    gh,
    upstream,
    head,
    mergeCommit,
    pr,
    release: releaser(repo, gh, branch),
    read,
    untouched,
  };
}

describe("release.sh and the cooldown", () => {
  it("refuses a release whose sync was merged before its 48 hours were over, and says how the owner waives it", () => {
    const { release, upstream, head, untouched } = merged({ approved: at(23, "10:00") });
    const result = release();
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain(
      "release: refused. This release would ship upstream changes that had not waited out the 48-hour cooldown when they were merged:",
    );
    expect(result.err).toContain(
      `upstream ${upstream.slice(0, 8)} came in through pull request #7 (${SYNC}), merged 2026-11-23 13:00 UTC: it was merged 3 hours after sync-approved was applied (2026-11-23 10:00 UTC); it would have been allowed from 2026-11-25 10:00 UTC.`,
    );
    expect(result.err).toContain(`To waive: upstream ${upstream}, pull request 7, commit ${head}.`);
    expect(result.err).toContain(
      'Only the repository owner can let it through: Actions > "Waive sync cooldown" > Run workflow on harden',
    );
    expect(result.err).toContain("release: nothing was changed");
    untouched();
  });

  it("gives the same verdict on a dry run, after showing what the release would be", () => {
    const { release, untouched } = merged({ approved: at(23, "10:00") });
    const result = release(["--dry-run"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("Dry run: nothing is written");
    expect(result.out).toContain("- fix: upstream two");
    expect(result.out).toContain("A real run would stop here:");
    expect(result.out).toContain("it would have been allowed from 2026-11-25 10:00 UTC");
    untouched();
  });

  it("releases a sync that had waited, and says so on a dry run too", () => {
    const { release, read, upstream } = merged();
    const line = `Sync cooldown: upstream ${upstream.slice(0, 8)} came in through pull request #7 (${SYNC}), merged 2026-11-23 13:00 UTC, 49 hours after sync-approved was applied (2026-11-21 12:00 UTC).`;
    const dry = release(["--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain(line);
    const result = release();
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain(line);
    expect(read("state/upstream-base")).toBe(`${upstream}\n`);
    expect(read("CODEHARDEN-CHANGELOG.md")).not.toContain("waived");
  });

  it("releases a sync the owner waived, and keeps the waiver in the changelog entry", () => {
    const { release, read, gh, upstream, head } = merged({ approved: at(23, "10:00") });
    const id = gh.waiverRun({ upstream, pullRequest: 7, commit: head, started: at(23, "12:00") });
    const result = release();
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      `Sync cooldown waived by the owner: upstream ${upstream.slice(0, 8)} came in through pull request #7 (${SYNC}), merged 2026-11-23 13:00 UTC; example approved the waiver run that started 2026-11-23 12:00 UTC (https://github.example/runs/${id}).`,
    );
    expect(read("CODEHARDEN-CHANGELOG.md")).toContain(
      `## 2026.1123.0905 — 2026-11-23 09:05\n\nSync cooldown waived by the owner for upstream ${upstream.slice(0, 8)} (approved by example, 2026-11-23 12:00 UTC).\n\n### upstream (leonvanzyl/codeden)\n- fix: upstream two\n\n### codeharden\n`,
    );
  });

  it("accepts a waiver given after the merge, and none for another commit, another head or by someone who may not", () => {
    const early = { events: [] };
    const after = merged(early);
    after.gh.waiverRun({
      upstream: after.upstream,
      pullRequest: 7,
      commit: after.head,
      started: at(23, "20:00"),
    });
    expect(after.release().code).toBe(0);

    const other = merged(early);
    other.gh.waiverRun({
      upstream: "e".repeat(40),
      pullRequest: 7,
      commit: other.head,
      started: at(23, "20:00"),
    });
    other.gh.waiverRun({
      upstream: other.upstream,
      pullRequest: 7,
      commit: "f".repeat(40),
      started: at(23, "20:00"),
    });
    other.gh.waiverRun({ upstream: other.upstream, commit: other.head, started: at(23, "20:00") });
    expect(other.release().code).toBe(1);

    const stranger = merged(early);
    stranger.gh.waiverRun({
      upstream: stranger.upstream,
      pullRequest: 7,
      commit: stranger.head,
      started: at(23, "20:00"),
      approvedBy: "someone-else",
    });
    expect(stranger.release().code).toBe(1);
    expect(stranger.release([], { SYNC_WAIVER_APPROVERS: "someone-else" }).code).toBe(0);
  });

  it("refuses a sync that was never approved, was on hold, or was pushed after its approval", () => {
    const never = merged({ events: [] }).release();
    expect(never.code).toBe(1);
    expect(never.err).toContain(
      "it did not have the label sync-approved when it was merged, so there is no time from which it would have been allowed",
    );

    // Approved only after it was merged: the label's time is what counts, not that it is there.
    const late = merged({ approved: at(23, "13:30") }).release();
    expect(late.code).toBe(1);
    expect(late.err).toContain("it did not have the label sync-approved when it was merged");

    const held = merged({
      events: [
        [at(21, "12:00"), "labeled", "sync-approved"],
        [at(22), "labeled", "sync-hold"],
      ],
    }).release();
    expect(held.code).toBe(1);
    expect(held.err).toContain(
      "it had the label sync-hold when it was merged; without the hold it would have been allowed from 2026-11-23 12:00 UTC",
    );

    const pushed = merged({
      pushes: (head) => [
        [at(23, "12:30"), head],
        [at(21, "11:00"), "a".repeat(40), "branch_creation"],
      ],
    }).release();
    expect(pushed.code).toBe(1);
    expect(pushed.err).toContain(
      "its head branch was pushed 2026-11-23 12:30 UTC, after sync-approved was applied (2026-11-21 12:00 UTC), so the approval did not cover what was merged",
    );
  });

  it("ignores what happened to the pull request after it was merged", () => {
    // The branch was deleted and the label taken off afterwards: at the merge all was in order.
    const { release } = merged({
      events: [
        [at(21, "12:00"), "labeled", "sync-approved"],
        [at(23, "14:00"), "unlabeled", "sync-approved"],
        [at(23, "14:01"), "labeled", "sync-hold"],
      ],
      pushes: (head) => [
        [at(23, "13:01"), "0".repeat(40), "branch_deletion"],
        [at(21, "11:00"), head, "branch_creation"],
      ],
    });
    expect(release().code).toBe(0);
  });

  it("reads a long history to its end: 250 commits before the label, 150 pushes after the merge", () => {
    const { release, gh, head } = merged();
    gh.labelEvents(7, [[at(21, "12:00"), "labeled", "sync-approved"]], 250);
    gh.pushes(SYNC, [
      ...Array.from({ length: 150 }, (_, i) => [
        at(24, `10:${String(i % 60).padStart(2, "0")}`),
        "b".repeat(40),
      ]),
      [at(21, "11:00"), head, "branch_creation"],
    ]);
    expect(release().code).toBe(0);
  });

  it("refuses upstream commits that came in without a pull request, until the owner waives exactly that commit", () => {
    const repo = fork();
    const gh = github();
    const upstream = repo.upstreamCommit();
    repo.git("merge", "--quiet", "--no-ff", "up", "-m", "Merge upstream by hand");
    const landing = repo.git("rev-parse", "HEAD");
    // A merge made here and not pushed: GitHub doesn't know the commit at all.
    gh.notPushed(landing);
    const release = releaser(repo, gh);
    const refused = release();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(
      `upstream ${upstream.slice(0, 8)} came in through the commit ${landing.slice(0, 8)} ("Merge upstream by hand"), which is not the merge of a pull request into harden: nothing was approved`,
    );
    expect(refused.err).toContain(
      `To waive: upstream ${upstream}, no pull request, commit ${landing}.`,
    );
    // A waiver that names a pull request or another commit is not for this one.
    gh.waiverRun({ upstream, pullRequest: 7, commit: landing, started: at(23, "20:00") });
    gh.waiverRun({ upstream, commit: "f".repeat(40), started: at(23, "20:30") });
    expect(release().code).toBe(1);
    gh.waiverRun({ upstream, commit: landing, started: at(23, "21:00") });
    const waived = release();
    expect(waived.code).toBe(0);
    expect(waived.out).toContain("Sync cooldown waived by the owner");
  });

  it("accounts for every landing: a second one merged by hand is not covered by the first sync", () => {
    // Sync #7 was in order. Then upstream moved again, and a branch with that upstream commit
    // and one ordinary commit on top was merged by hand.
    const { repo, gh, release, upstream } = merged();
    const second = repo.upstreamCommit("upstream-3.txt", "feat: upstream three");
    repo.git("checkout", "--quiet", "-b", "by-hand", "up");
    repo.commit("extra.txt", "chore: one ordinary commit");
    repo.git("checkout", "--quiet", "harden");
    repo.git("merge", "--quiet", "--no-ff", "by-hand", "-m", "Merge branch 'by-hand'");
    const landing = repo.git("rev-parse", "HEAD");
    const refused = release();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(
      `upstream ${second.slice(0, 8)} came in through the commit ${landing.slice(0, 8)} ("Merge branch 'by-hand'"), which is not the merge of a pull request into harden`,
    );
    expect(refused.err).not.toContain("pull request #7");
    gh.waiverRun({ upstream: second, commit: landing, started: at(24) });
    const released = release();
    expect(released.code).toBe(0);
    expect(released.out).toContain(
      `Sync cooldown: upstream ${upstream.slice(0, 8)} came in through pull request #7`,
    );
    expect(released.out).toContain(
      `Sync cooldown waived by the owner: upstream ${second.slice(0, 8)} came in through the commit`,
    );
  });

  it("accounts for every upstream commit: one that arrived by a fast-forward is not covered by a later sync", () => {
    // Upstream is this fork's own line with more on top, and the branch was fast-forwarded
    // onto it: no merge, no pull request. A later sync, properly approved and cooled, comes
    // on top.
    const repo = fork();
    const gh = github();
    repo.git("checkout", "--quiet", "up");
    repo.git("merge", "--quiet", "--ff-only", "harden");
    const forwarded = repo.commit("upstream-fast.txt", "feat: upstream, on top of the fork");
    repo.git("checkout", "--quiet", "harden");
    repo.git("merge", "--quiet", "--ff-only", "up");
    const later = repo.upstreamCommit();
    const mergeCommit = repo.merge("up", 7);
    const pr = gh.pull(7, { head: later, ref: SYNC, merged: at(23, "13:00"), mergeCommit });
    gh.labelEvents(7, [[at(21, "12:00"), "labeled", "sync-approved"]]);
    gh.pushes(SYNC, [[at(21, "11:00"), later, "branch_creation"]]);
    gh.closedPulls([pr]);
    const release = releaser(repo, gh);
    const refused = release();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(
      `upstream ${forwarded.slice(0, 8)} is on harden's own line: it arrived by a fast-forward or a direct push, not through a pull request: nothing was approved`,
    );
    expect(refused.err).toContain(
      `To waive: upstream ${forwarded}, no pull request, commit ${forwarded}.`,
    );
    // The sync on top was in order, and is not what is refused.
    expect(refused.err).not.toContain("pull request #7");
    gh.waiverRun({ upstream: forwarded, commit: forwarded, started: at(23, "20:00") });
    const released = release();
    expect(released.err).toBe("");
    expect(released.code).toBe(0);
    expect(released.out).toContain(
      `Sync cooldown waived by the owner: upstream ${forwarded.slice(0, 8)} is on harden's own line`,
    );
    expect(released.out).toContain(
      `Sync cooldown: upstream ${later.slice(0, 8)} came in through pull request #7`,
    );
  });

  it("names the pull request that really landed the commits, also when it was not the sync's own", () => {
    // The sync branch was merged into a working branch, and that branch's pull request landed it.
    const repo = fork();
    const gh = github();
    const upstream = repo.upstreamCommit();
    repo.syncBranch(SYNC);
    repo.git("checkout", "--quiet", "-b", "codeden/second-review", "harden");
    repo.git("merge", "--quiet", "--no-ff", SYNC, "-m", `Merge branch '${SYNC}' into harden`);
    const head = repo.commit("review.txt", "fix: review findings");
    repo.git("checkout", "--quiet", "harden");
    const mergeCommit = repo.merge("codeden/second-review", 28);
    const pr = gh.pull(28, {
      head,
      ref: "codeden/second-review",
      merged: at(23, "17:15"),
      mergeCommit,
    });
    gh.pushes("codeden/second-review", [[at(23, "17:00"), head]]);
    gh.closedPulls([pr]);
    const result = releaser(repo, gh)();
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      `upstream ${upstream.slice(0, 8)} came in through pull request #28 (codeden/second-review), merged 2026-11-23 17:15 UTC: it did not have the label sync-approved when it was merged`,
    );
    expect(result.err).toContain(
      `To waive: upstream ${upstream}, pull request 28, commit ${head}.`,
    );
  });

  it("finds the pull request by its commit when the list of merged ones doesn't have it", () => {
    const { release, gh, mergeCommit, pr } = merged();
    gh.closedPulls([{ ...pr, number: 3, merge_commit_sha: "f".repeat(40) }]);
    expect(release().err).toContain("which is not the merge of a pull request into harden");
    gh.pullsOfCommit(mergeCommit, [pr]);
    expect(release().code).toBe(0);
  });

  it("judges each sync of a release by itself", () => {
    const { repo, gh, release, upstream, pr: first } = merged();
    const second = repo.upstreamCommit("upstream-3.txt", "feat: upstream three");
    const head = repo.syncBranch("sync/2026-11-24");
    const mergeCommit = repo.merge("sync/2026-11-24", 9);
    const pr = gh.pull(9, { head, ref: "sync/2026-11-24", merged: at(24, "13:00"), mergeCommit });
    gh.labelEvents(9, [[at(24, "09:00"), "labeled", "sync-approved"]]);
    gh.pushes("sync/2026-11-24", [[at(24, "08:00"), head, "branch_creation"]]);
    gh.closedPulls([pr, first]);
    const refused = release();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(`upstream ${second.slice(0, 8)} came in through pull request #9`);
    expect(refused.err).not.toContain("pull request #7");
    gh.waiverRun({ upstream: second, pullRequest: 9, commit: head, started: at(24, "12:00") });
    const released = release();
    expect(released.code).toBe(0);
    expect(released.out).toContain(
      `Sync cooldown: upstream ${upstream.slice(0, 8)} came in through pull request #7`,
    );
    expect(released.out).toContain(
      `Sync cooldown waived by the owner: upstream ${second.slice(0, 8)} came in through pull request #9`,
    );
  });

  it("refuses when GitHub can't be asked, and a dry run still explains", () => {
    const noGh = merged();
    const missing = noGh.release([], { PATH: pathWithoutGh() });
    expect(missing.code).toBe(1);
    expect(missing.err).toContain(
      "release: refused. It could not be decided whether what was merged since the last release waited out its cooldown, and no release is cut without that answer.",
    );
    expect(missing.err).toContain("the GitHub CLI (gh) is not on PATH");
    expect(missing.err).toContain("release: nothing was changed");
    noGh.untouched();

    const dry = noGh.release(["--dry-run"], { PATH: pathWithoutGh() });
    expect(dry.code).toBe(1);
    expect(dry.out).toContain("New entry in CODEHARDEN-CHANGELOG.md:");
    expect(dry.out).toContain("A real run would stop here:");
    expect(dry.out).toContain("the GitHub CLI (gh) is not on PATH");
  });

  it("refuses a release of our own commits too when GitHub can't be asked: a squashed sync would look like one", () => {
    const repo = fork();
    const gh = github();
    const release = releaser(repo, gh);
    expect(release().code).toBe(0);
    const again = (env) => release([], { RELEASE_NOW: "2026.1123.0906 2026-11-23 09:06", ...env });
    repo.commit("more.txt", "fix: one more");
    const missing = again({ PATH: pathWithoutGh() });
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("the GitHub CLI (gh) is not on PATH");
    expect(again().code).toBe(0);
  });

  it("refuses when a call to GitHub fails, whichever it is, or when there is no repository to ask", () => {
    for (const pattern of ["GET repos/[^ ]+/pulls$", "pulls/7", "timeline", "activity"]) {
      const down = merged();
      down.gh.fail(pattern);
      const result = down.release();
      expect(result.code).toBe(1);
      expect(result.err).toContain("It could not be decided");
      expect(result.err).toContain("GitHub did not answer");
      down.untouched();
    }
    // The list has no pull request for the merge, and the question about the commit fails.
    const byCommit = merged();
    byCommit.gh.closedPulls([]);
    byCommit.gh.fail("commits/");
    expect(byCommit.release().err).toContain("GitHub did not answer");

    const nowhere = merged();
    const unnamed = nowhere.release([], { GITHUB_REPOSITORY: "" });
    expect(unnamed.code).toBe(1);
    expect(unnamed.err).toContain("there is no repository to ask");
    nowhere.untouched();
  });

  it("works in a fork whose working branch has another name", () => {
    const fine = merged({ branch: "trunk" });
    const released = fine.release();
    expect(released.err).toBe("");
    expect(released.code).toBe(0);
    const early = merged({ branch: "trunk", approved: at(23, "10:00") });
    const refused = early.release();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("Run workflow on trunk");
    // A pull request into another branch is not the one that landed it on this one.
    early.gh.closedPulls([{ ...early.pr, base: { ref: "harden" } }]);
    expect(early.release().err).toContain("which is not the merge of a pull request into trunk");
  });
});

describe("release.sh and syncs merged without their history", () => {
  /**
   * A fork whose pull request #7 (a sync branch by default) was squashed onto the branch on
   * the 23rd at 13:00: one new commit, and no upstream commit in the branch's history.
   */
  function squashed({ approved = at(21, "12:00"), ref = SYNC } = {}) {
    const repo = fork();
    const gh = github();
    const upstream = repo.upstreamCommit();
    const head = repo.syncBranch(ref);
    repo.git("merge", "--quiet", "--squash", ref);
    repo.git("commit", "--quiet", "-m", "sync: upstream (#7)");
    const mergeCommit = repo.git("rev-parse", "HEAD");
    const pr = gh.pull(7, { head, ref, merged: at(23, "13:00"), mergeCommit });
    gh.labelEvents(7, approved ? [[approved, "labeled", "sync-approved"]] : []);
    gh.pushes(ref, [[at(21, "11:00"), head, "branch_creation"]]);
    gh.closedPulls([pr]);
    return { repo, gh, upstream, head, mergeCommit, pr, release: releaser(repo, gh) };
  }

  it("asks about a squashed sync, though the upstream base did not move", () => {
    const { release, repo, upstream, head } = squashed({ approved: at(23, "10:00") });
    // To git, upstream never arrived.
    expect(repo.git("merge-base", "HEAD", "up")).toBe(
      repo.git("show", "v2026.1122.2006:state/upstream-base"),
    );
    const result = release();
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      `pull request #7 (${SYNC}), merged 2026-11-23 13:00 UTC without its history (squashed or rebased), carries upstream up to ${upstream.slice(0, 8)}: it was merged 3 hours after sync-approved was applied (2026-11-23 10:00 UTC); it would have been allowed from 2026-11-25 10:00 UTC.`,
    );
    expect(result.err).toContain(`To waive: upstream ${upstream}, pull request 7, commit ${head}.`);
  });

  it("lets a squashed sync through when it had waited, or the owner waived it", () => {
    const waited = squashed();
    const fine = waited.release();
    expect(fine.err).toBe("");
    expect(fine.code).toBe(0);
    expect(fine.out).toContain("Sync cooldown: pull request #7");

    const early = squashed({ approved: null });
    expect(early.release().code).toBe(1);
    early.gh.waiverRun({
      upstream: early.upstream,
      pullRequest: 7,
      commit: early.head,
      started: at(23, "20:00"),
    });
    const waived = early.release();
    expect(waived.code).toBe(0);
    expect(waived.out).toContain("Sync cooldown waived by the owner: pull request #7");
  });

  it("asks about any squashed branch that carried upstream commits, whatever it was called", () => {
    const { release, upstream } = squashed({ approved: null, ref: "codeden/bring-upstream" });
    const result = release();
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      `pull request #7 (codeden/bring-upstream), merged 2026-11-23 13:00 UTC without its history (squashed or rebased), carries upstream up to ${upstream.slice(0, 8)}: it did not have the label sync-approved`,
    );
  });

  it("leaves an ordinary squashed pull request alone, also one that was branched after a sync", () => {
    // Sync #7 landed properly; then a feature branch, which has that upstream commit in its
    // history like everything after the sync, was squashed.
    const repo = fork();
    const gh = github();
    repo.upstreamCommit();
    const syncHead = repo.syncBranch(SYNC);
    const syncMerge = repo.merge(SYNC, 7);
    const sync = gh.pull(7, {
      head: syncHead,
      ref: SYNC,
      merged: at(23, "13:00"),
      mergeCommit: syncMerge,
    });
    gh.labelEvents(7, [[at(21, "12:00"), "labeled", "sync-approved"]]);
    gh.pushes(SYNC, [[at(21, "11:00"), syncHead, "branch_creation"]]);
    repo.git("checkout", "--quiet", "-b", "feature/x", "harden");
    const head = repo.commit("feature.txt", "feat: ours");
    repo.git("checkout", "--quiet", "harden");
    repo.git("merge", "--quiet", "--squash", "feature/x");
    repo.git("commit", "--quiet", "-m", "feat: ours (#8)");
    const feature = gh.pull(8, {
      head,
      ref: "feature/x",
      merged: at(23, "14:00"),
      mergeCommit: repo.git("rev-parse", "HEAD"),
    });
    gh.closedPulls([feature, sync]);
    const result = releaser(repo, gh)();
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("came in through pull request #7");
    expect(result.out).not.toContain("#8");
    // Nothing was asked about #8 but the list it came in.
    expect(gh.calls().some((call) => call.includes("pulls/8"))).toBe(false);
  });

  it("refuses when a squashed pull request's head is not here and can't be fetched", () => {
    const { release, gh, pr } = squashed();
    gh.closedPulls([{ ...pr, head: { ...pr.head, sha: "c".repeat(40) } }]);
    const result = release();
    expect(result.code).toBe(1);
    expect(result.err).toContain("It could not be decided");
    expect(result.err).toContain(
      `The head commit of pull request #7 (${"c".repeat(40)}), merged since the last release, is not here and could not be fetched`,
    );
  });

  it("fetches a squashed pull request's head from the remote, in a clone that has only the branch", () => {
    const { repo, gh, head, upstream } = squashed({ approved: at(23, "10:00") });
    const remote = mkdtempSync(join(tmpdir(), "codeharden-release-remote-"));
    sh(remote, "git", ["init", "--quiet", "--bare"]);
    repo.git("remote", "add", "origin", remote);
    repo.git("push", "--quiet", "origin", "harden", "v2026.1122.2006", `${head}:refs/pull/7/head`);
    const clone = mkdtempSync(join(tmpdir(), "codeharden-release-clone-"));
    sh(clone, "git", [
      "clone",
      "--quiet",
      "--no-local",
      "--branch",
      "harden",
      "--single-branch",
      remote,
      ".",
    ]);
    expect(sh(clone, "git", ["cat-file", "-e", `${head}^{commit}`]).code).not.toBe(0);
    const result = sh(clone, "bash", [RELEASE], {
      RELEASE_NOW: NOW,
      ...gh.env,
      GITHUB_REPOSITORY: REPO,
      UPSTREAM_URL: repo.dir,
      UPSTREAM_BRANCH: "up",
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      `without its history (squashed or rebased), carries upstream up to ${upstream.slice(0, 8)}`,
    );
  });
});

describe("publish.sh", () => {
  it("refuses a tree with changes, a checkout off the release tag, and a missing tag", () => {
    const repo = scratch();
    // On the tag, but with an untracked file.
    writeFileSync(join(repo.dir, "stray.txt"), "x\n");
    const dirty = sh(repo.dir, "bash", [PUBLISH, "--dry-run"]);
    expect(dirty.code).toBe(1);
    expect(dirty.err).toContain("the working tree has changes");

    repo.commit("stray.txt", "chore: past the release");
    const off = sh(repo.dir, "bash", [PUBLISH, "--dry-run"]);
    expect(off.code).toBe(1);
    expect(off.err).toContain("HEAD is not the release v2026.1122.2006");

    writeFileSync(join(repo.dir, "VERSION"), "2026.1201.0000\n");
    repo.git("commit", "--quiet", "-am", "pretend release without a tag");
    const untagged = sh(repo.dir, "bash", [PUBLISH]);
    expect(untagged.code).toBe(1);
    expect(untagged.err).toContain("the tag v2026.1201.0000 is not in this checkout");
  });

  it("rejects options it doesn't know (there is no one-time code option)", () => {
    const repo = scratch();
    const result = sh(repo.dir, "bash", [PUBLISH, "--otp", "123456"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("unknown option --otp");
  });
});
