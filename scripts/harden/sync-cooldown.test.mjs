// The cooldown rule (sync-cooldown.sh) and the status it shows (sync-cooldown-report.sh), in a
// scratch repository against a stub `gh`: no network, and the clock is the test's.
import { describe, expect, it } from "vitest";
import {
  at,
  fork,
  github,
  pathWithoutGh,
  REPO,
  script,
  verdict,
} from "./test-support/cooldown.mjs";
import { sh } from "./test-support/scratch.mjs";

const SYNC = "sync/2026-11-23";
const APPROVED = at(23, "14:55");

/** A fork with an open sync pull request #7, approved on the 23rd at 14:55 and not touched since. */
function approvedSync({ branch = "harden" } = {}) {
  const repo = fork(branch);
  const gh = github();
  const upstream = repo.upstreamCommit();
  const head = repo.syncBranch(SYNC);
  gh.pull(7, { head, ref: SYNC, labels: ["sync-approved"], base: branch });
  gh.labelEvents(7, [[APPROVED, "labeled", "sync-approved"]]);
  gh.pushes(SYNC, [[at(23, "14:50"), head, "branch_creation"]]);
  const ask = (now, env = {}) => {
    const result = repo.run(
      "sync-cooldown.sh",
      ["pull-request", "7", "--upstream-ref", "up", "--target-ref", branch, "--branch", branch],
      { ...gh.env, SYNC_COOLDOWN_NOW: now, ...env },
    );
    return { ...result, ...verdict(result.out) };
  };
  const report = (now, args = ["pull-request", "7"], env = {}) => {
    const result = repo.run(
      "sync-cooldown-report.sh",
      [...args, "--upstream-ref", "up", "--target-ref", branch],
      { ...gh.env, SYNC_COOLDOWN_NOW: now, HARDEN_BRANCH: branch, ...env },
    );
    return { ...result, ...verdict(result.out) };
  };
  return { repo, gh, upstream, head, ask, report };
}

describe("the cooldown's clock", () => {
  const source = `. "${script("sync-cooldown.sh")}"`;
  const epoch = (text) =>
    sh(process.cwd(), "bash", ["-c", `${source}; cd_epoch "$1"`, "bash", text]);

  it("reads GitHub's times exactly, leap days and century years included", () => {
    for (const text of [
      "1970-01-01T00:00:00Z",
      "2000-02-29T23:59:59Z",
      "2024-02-29T12:00:00Z",
      "2026-11-23T14:55:33Z",
      "2026-12-31T23:59:59Z",
      "2027-01-01T00:00:00Z",
      "2100-03-01T00:00:00Z",
    ]) {
      expect(epoch(text).out).toBe(String(Date.parse(text) / 1000));
    }
    expect(epoch("2026-11-23T14:55:33.123Z").out).toBe(
      String(Date.parse("2026-11-23T14:55:33Z") / 1000),
    );
  });

  it("refuses a time it can't read instead of guessing", () => {
    for (const text of ["2026-11-23T14:55:33-05:00", "2026-11-23 14:55:33", "yesterday", ""]) {
      expect(epoch(text).code).toBe(1);
    }
  });

  it("writes a moment back in UTC", () => {
    const time = (seconds, form = "") =>
      sh(process.cwd(), "bash", ["-c", `${source}; cd_time "$1" $2`, "bash", String(seconds), form])
        .out;
    for (const text of ["2026-11-25T14:55:33Z", "2024-02-29T00:00:00Z", "2027-01-01T00:00:59Z"]) {
      const seconds = Date.parse(text) / 1000;
      expect(time(seconds, "iso")).toBe(text);
      expect(time(seconds)).toBe(`${text.slice(0, 10)} ${text.slice(11, 16)} UTC`);
    }
  });
});

describe("the cooldown rule, for an open pull request", () => {
  it("waits while the approval is younger than 48 hours, and says when it will be green", () => {
    const { ask, upstream, head } = approvedSync();
    const result = ask(at(24, "10:00"));
    expect(result.code).toBe(1);
    expect(result.state).toBe("waiting");
    expect(result.status).toBe("pending");
    expect(result.short).toBe(
      "Cooling down until 2026-11-25 14:55 UTC (approved 2026-11-23 14:55 UTC). Expected. Not a CI check.",
    );
    expect(result.ready).toBe("2026-11-25T14:55:00Z");
    expect(result.upstream).toBe(upstream);
    expect(result.head).toBe(head);
    // One second short of 48 hours is still short.
    expect(ask("2026-11-25T14:54:59Z").state).toBe("waiting");
  });

  it("is over once 48 hours have passed with nothing pushed", () => {
    const { ask } = approvedSync();
    const result = ask(at(25, "14:55"));
    expect(result.code).toBe(0);
    expect(result.state).toBe("satisfied");
    expect(result.status).toBe("success");
    expect(result.short).toBe(
      "Cooldown over: approved 2026-11-23 14:55 UTC, 48 hours passed, nothing pushed since.",
    );
    expect(result.ready).toBe("");
  });

  it("fails when the head branch was pushed after the approval, however long ago that was", () => {
    const { ask, gh, head } = approvedSync();
    gh.pushes(SYNC, [
      [at(24, "09:00"), head, "force_push"],
      [at(23, "14:50"), "a".repeat(40), "branch_creation"],
    ]);
    const result = ask(at(28));
    expect(result.code).toBe(1);
    expect(result.state).toBe("head-moved");
    expect(result.status).toBe("failure");
    expect(result.short).toBe(
      "Pushed 2026-11-24 09:00 UTC, after the approval (2026-11-23 14:55 UTC). Re-apply sync-approved. Not a CI check.",
    );
  });

  it("counts a push in the same second as the approval as after it", () => {
    // GitHub's times are whole seconds, so the order inside one can't be known.
    const { ask, gh, head } = approvedSync();
    gh.pushes(SYNC, [
      [APPROVED, head],
      [at(23, "14:50"), "a".repeat(40), "branch_creation"],
    ]);
    const result = ask(at(28));
    expect(result.code).toBe(1);
    expect(result.state).toBe("head-moved");
    expect(result.short).toBe(
      "Pushed 2026-11-23 14:55 UTC, in the same second as the approval (2026-11-23 14:55 UTC). Re-apply sync-approved. Not a CI check.",
    );
    // One second earlier it is before the approval.
    gh.pushes(SYNC, [["2026-11-23T14:54:59Z", head]]);
    expect(ask(at(28)).state).toBe("satisfied");
  });

  it("starts again when the label is re-applied, from the newest time it was applied", () => {
    const { ask, gh, head } = approvedSync();
    gh.pushes(SYNC, [[at(24, "09:00"), head]]);
    gh.labelEvents(7, [
      [APPROVED, "labeled", "sync-approved"],
      [at(24, "09:30"), "unlabeled", "sync-approved"],
      [at(24, "09:31"), "labeled", "sync-approved"],
    ]);
    // 48 hours after the first approval, 5 hours after the second: not yet.
    const early = ask(at(25, "15:00"));
    expect(early.state).toBe("waiting");
    expect(early.ready).toBe("2026-11-26T09:31:00Z");
    expect(ask(at(26, "09:31")).state).toBe("satisfied");
  });

  it("is not approved without the label, or once it was taken off again", () => {
    const { ask, gh, head } = approvedSync();
    gh.labelEvents(7, [
      [APPROVED, "labeled", "sync-approved"],
      [at(24), "unlabeled", "sync-approved"],
    ]);
    gh.pull(7, { head, ref: SYNC, labels: [] });
    const removed = ask(at(28));
    expect(removed.code).toBe(1);
    expect(removed.state).toBe("not-approved");
    expect(removed.short).toBe(
      "Not approved yet: the 48 hours start when sync-approved is applied. Not a CI check.",
    );
    // The timeline alone is not enough for an open pull request: the label must be on it now.
    gh.labelEvents(7, [[APPROVED, "labeled", "sync-approved"]]);
    expect(ask(at(28)).state).toBe("not-approved");
  });

  it("stays pending on hold, the hours still running, and is green without it", () => {
    const { ask, gh, head } = approvedSync();
    gh.pull(7, { head, ref: SYNC, labels: ["sync-approved", "sync-hold"] });
    gh.labelEvents(7, [
      [APPROVED, "labeled", "sync-approved"],
      [at(24), "labeled", "sync-hold"],
    ]);
    const held = ask(at(28));
    expect(held.code).toBe(1);
    expect(held.state).toBe("held");
    expect(held.status).toBe("pending");
    expect(held.short).toBe(
      "On hold (label sync-hold). The 48 hours since the approval ended 2026-11-25 14:55 UTC. Not a CI check.",
    );
    gh.pull(7, { head, ref: SYNC, labels: ["sync-approved"] });
    gh.labelEvents(7, [
      [APPROVED, "labeled", "sync-approved"],
      [at(24), "labeled", "sync-hold"],
      [at(27), "unlabeled", "sync-hold"],
    ]);
    expect(ask(at(28)).state).toBe("satisfied");
  });

  it("does not look at sync-needs-review: a person merges that one, once it is green", () => {
    const { ask, gh, head } = approvedSync();
    gh.pull(7, { head, ref: SYNC, labels: ["sync-approved", "sync-needs-review"] });
    gh.labelEvents(7, [
      [APPROVED, "labeled", "sync-approved"],
      [at(24), "labeled", "sync-needs-review"],
    ]);
    expect(ask(at(24, "10:00")).state).toBe("waiting");
    expect(ask(at(26)).state).toBe("satisfied");
  });

  it("is pending while GitHub's push record is not at the head, and red for a head in another repository", () => {
    const { ask, gh, head } = approvedSync();
    gh.pushes(SYNC, [[at(23, "14:50"), "b".repeat(40)]]);
    const behind = ask(at(28));
    expect(behind.code).toBe(1);
    expect(behind.state).toBe("unsettled");
    expect(behind.status).toBe("pending");
    gh.pushes(SYNC, []);
    expect(ask(at(28)).state).toBe("unsettled");

    gh.pull(7, { head, ref: SYNC, labels: ["sync-approved"], repo: "someone/else" });
    const foreign = ask(at(28));
    expect(foreign.state).toBe("foreign");
    expect(foreign.status).toBe("failure");
  });

  it("leaves a pull request that brings no upstream commits alone, and asks GitHub nothing more", () => {
    const repo = fork();
    const gh = github();
    repo.upstreamCommit();
    repo.git("checkout", "--quiet", "-b", "feature/x");
    const head = repo.commit("feature.txt", "feat: ours");
    repo.git("checkout", "--quiet", "harden");
    gh.pull(8, { head, ref: "feature/x" });
    const result = repo.run(
      "sync-cooldown.sh",
      ["pull-request", "8", "--upstream-ref", "up", "--target-ref", "harden", "--branch", "harden"],
      gh.env,
    );
    expect(result.code).toBe(0);
    expect(verdict(result.out).state).toBe("not-a-sync");
    expect(gh.calls()).toHaveLength(1);
    // Nor one into another branch.
    gh.pull(8, { head, ref: "sync/elsewhere", base: "release-1" });
    expect(
      verdict(
        repo.run(
          "sync-cooldown.sh",
          [
            "pull-request",
            "8",
            "--upstream-ref",
            "up",
            "--target-ref",
            "harden",
            "--branch",
            "harden",
          ],
          gh.env,
        ).out,
      ).state,
    ).toBe("not-a-sync");
  });

  it("applies to any branch that carries new upstream commits, whatever its name", () => {
    const repo = fork();
    const gh = github();
    const upstream = repo.upstreamCommit();
    repo.git("checkout", "--quiet", "-b", "codeden/bring-upstream");
    repo.git("merge", "--quiet", "--no-ff", "up", "-m", "Merge upstream");
    const head = repo.git("rev-parse", "HEAD");
    repo.git("checkout", "--quiet", "harden");
    gh.pull(9, { head, ref: "codeden/bring-upstream" });
    gh.pushes("codeden/bring-upstream", [[at(23), head]]);
    const result = repo.run(
      "sync-cooldown.sh",
      ["pull-request", "9", "--upstream-ref", "up", "--target-ref", "harden", "--branch", "harden"],
      { ...gh.env, SYNC_COOLDOWN_NOW: at(28) },
    );
    expect(result.code).toBe(1);
    expect(verdict(result.out)).toMatchObject({ state: "not-approved", upstream });
  });

  it("works in a fork whose working branch has another name", () => {
    const { ask } = approvedSync({ branch: "trunk" });
    expect(ask(at(24)).state).toBe("waiting");
    expect(ask(at(26)).state).toBe("satisfied");
  });

  it("keeps every status line within the 140 characters GitHub shows", () => {
    const { ask, gh, head } = approvedSync();
    const lines = [ask(at(24)).short, ask(at(26)).short];
    gh.pull(7, { head, ref: `${SYNC}-${"long-branch-name-".repeat(6)}`, labels: ["sync-hold"] });
    lines.push(ask(at(26)).short);
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(20);
      expect(line.length).toBeLessThanOrEqual(140);
    }
  });
});

describe("the cooldown rule, when GitHub can't be asked", () => {
  it("is not a yes when a call fails", () => {
    for (const pattern of ["pulls/7", "timeline", "activity"]) {
      const { ask, gh } = approvedSync();
      gh.fail(pattern);
      const result = ask(at(28));
      expect(result.code).toBe(2);
      expect(result.state).toBe("unknown");
      expect(result.status).toBe("error");
      expect(result.detail).toContain("GitHub did not answer");
    }
  });

  it("is not a yes without gh, without a repository to ask, or without the head commit", () => {
    const { ask, gh, repo } = approvedSync();
    const missing = ask(at(28), { PATH: pathWithoutGh() });
    expect(missing.code).toBe(2);
    expect(missing.detail).toContain("the GitHub CLI (gh) is not on PATH");

    const nowhere = ask(at(28), { SYNC_COOLDOWN_REPO: "" });
    expect(nowhere.code).toBe(2);
    expect(nowhere.detail).toContain("there is no repository to ask");

    gh.pull(7, { head: "c".repeat(40), ref: SYNC, labels: ["sync-approved"] });
    const gone = ask(at(28));
    expect(gone.code).toBe(2);
    expect(gone.detail).toContain("is not in this clone");
    expect(repo.git("status", "--porcelain")).toBe("");
  });

  it("is not a yes when the head is not the one the caller saw", () => {
    const { repo, gh } = approvedSync();
    const result = repo.run(
      "sync-cooldown.sh",
      [
        "pull-request",
        "7",
        "--upstream-ref",
        "up",
        "--target-ref",
        "harden",
        "--branch",
        "harden",
        "--head",
        "d".repeat(40),
      ],
      { ...gh.env, SYNC_COOLDOWN_NOW: at(28) },
    );
    expect(result.code).toBe(2);
    expect(verdict(result.out).detail).toContain("head changed while it was being looked at");
  });
});

describe("the owner's waiver", () => {
  it("makes the pull request green at once, and says who waived it", () => {
    const { ask, gh, upstream, head } = approvedSync();
    const id = gh.waiverRun({ upstream, pullRequest: 7, commit: head, started: at(24, "09:00") });
    const result = ask(at(24, "10:00"));
    expect(result.code).toBe(0);
    expect(result.state).toBe("waived");
    expect(result.status).toBe("success");
    expect(result.short).toBe(
      "Cooldown waived by the owner (approved by example, 2026-11-24 09:00 UTC).",
    );
    expect(result.url).toBe(`https://github.example/runs/${id}`);
  });

  it("covers a pull request that is not approved or is on hold: it is the owner's decision", () => {
    const { ask, gh, upstream, head } = approvedSync();
    gh.pull(7, { head, ref: SYNC, labels: ["sync-hold"] });
    gh.labelEvents(7, [[at(23), "labeled", "sync-hold"]]);
    expect(ask(at(24, "10:00")).state).toBe("held");
    gh.waiverRun({ upstream, pullRequest: 7, commit: head, started: at(24, "09:00") });
    expect(ask(at(24, "10:00")).state).toBe("waived");
  });

  it("is for one head: after a push the new head is not waived, whatever GitHub's push record says", () => {
    const { ask, gh, repo, upstream, head } = approvedSync();
    gh.waiverRun({ upstream, pullRequest: 7, commit: head, started: at(24, "09:00") });
    expect(ask(at(24, "10:00")).state).toBe("waived");
    // Something more is pushed to the sync branch.
    repo.git("checkout", "--quiet", SYNC);
    const moved = repo.commit("resolution.txt", "fix: another resolution");
    repo.git("checkout", "--quiet", "harden");
    gh.pull(7, { head: moved, ref: SYNC, labels: ["sync-approved"] });
    // Even with a push record that still shows the old push only.
    const stale = ask(at(24, "10:00"));
    expect(stale.code).toBe(1);
    expect(stale.state).toBe("unsettled");
    gh.pushes(SYNC, [[at(24, "09:30"), moved]]);
    const result = ask(at(24, "10:00"));
    expect(result.state).toBe("head-moved");
    // Nothing of the waiver for the other head is left in the verdict.
    expect(result.url).toBe("");
  });

  /** The state with one run of the waiver workflow that differs from a waiver as `run` says. */
  const withRun = (run, env) => {
    const { ask, gh, upstream, head } = approvedSync();
    gh.waiverRun({
      upstream,
      pullRequest: 7,
      commit: head,
      started: at(24, "09:00"),
      ...run(upstream, head),
    });
    return ask(at(24, "10:00"), env).state;
  };

  it("counts only a run that was approved in the waiver environment, that succeeded, on the working branch", () => {
    expect(withRun(() => ({ approvedBy: null }))).toBe("waiting");
    expect(withRun(() => ({ approval: "rejected" }))).toBe("waiting");
    expect(withRun(() => ({ environment: "release" }))).toBe("waiting");
    expect(withRun(() => ({ conclusion: "failure" }))).toBe("waiting");
    expect(withRun(() => ({ branch: "somewhere-else" }))).toBe("waiting");
  });

  it("counts only an approval by the repository's owner, or by a login the repository names", () => {
    expect(withRun(() => ({ approvedBy: "someone-else" }))).toBe("waiting");
    const named = { SYNC_WAIVER_APPROVERS: "A-Maintainer someone-else" };
    expect(withRun(() => ({ approvedBy: "someone-else" }), named)).toBe("waived");
    expect(withRun(() => ({ approvedBy: "a-maintainer" }), named)).toBe("waived");
    // With the variable set, the list is the whole of it.
    expect(withRun(() => ({ approvedBy: "example" }), named)).toBe("waiting");
    expect(withRun(() => ({ approvedBy: "Example" }))).toBe("waived");
  });

  it("counts only a run whose title is exactly this upstream commit, pull request and head", () => {
    const not = withRun;
    expect(not(() => ({ upstream: "e".repeat(40) }))).toBe("waiting");
    expect(not(() => ({ pullRequest: 8 }))).toBe("waiting");
    expect(not(() => ({ pullRequest: "none" }))).toBe("waiting");
    expect(not(() => ({ commit: "f".repeat(40) }))).toBe("waiting");
    // A title that only contains the right words is not the waiver's title.
    expect(
      not((upstream, head) => ({
        title: `Waive sync cooldown: upstream ${upstream}, pull request 7, commit ${head}, commit ${"f".repeat(40)}`,
      })),
    ).toBe("waiting");
    expect(
      not((upstream, head) => ({
        title: `waive sync cooldown: upstream ${upstream}, pull request 7, commit ${head}`,
      })),
    ).toBe("waiting");
    expect(not(() => ({}))).toBe("waived");
  });

  it("is no waiver when the waiver runs can't be read", () => {
    const { ask, gh, upstream, head } = approvedSync();
    gh.waiverRun({ upstream, pullRequest: 7, commit: head, started: at(24, "09:00") });
    gh.fail("approvals");
    expect(ask(at(24, "10:00")).state).toBe("waiting");
    gh.fail("actions/workflows");
    expect(ask(at(24, "10:00")).state).toBe("waiting");
  });
});

describe("GitHub's lists, read to the end", () => {
  it("finds the approval behind more than a page of other events", () => {
    const { ask, gh } = approvedSync();
    // A sync of 250 commits: the label events are on the third page of the timeline.
    gh.labelEvents(7, [[APPROVED, "labeled", "sync-approved"]], 250);
    expect(ask(at(24)).state).toBe("waiting");
    expect(ask(at(26)).state).toBe("satisfied");
  });

  it("finds a merged pull request's last push behind more than a page of later ones", () => {
    const { ask, gh, head } = approvedSync();
    gh.pull(7, { head, ref: SYNC, labels: [], merged: at(26) });
    // The branch name was used again afterwards, 150 times.
    const later = Array.from({ length: 150 }, (_, i) => [
      `2026-11-27T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`,
      "b".repeat(40),
    ]).reverse();
    gh.pushes(SYNC, [...later, [at(23, "14:50"), head, "branch_creation"]]);
    const result = ask(at(28));
    expect(result.code).toBe(0);
    expect(result.state).toBe("satisfied");
  });

  it("finds a waiver behind more than a page of other runs, and asks for every page", () => {
    const { ask, gh, upstream, head } = approvedSync();
    gh.waiverRun({ upstream, pullRequest: 7, commit: head, started: at(24, "09:00") });
    for (let i = 0; i < 120; i++) {
      gh.waiverRun({
        upstream: "e".repeat(40),
        pullRequest: 7,
        commit: head,
        started: at(24, "09:30"),
      });
    }
    expect(ask(at(24, "10:00")).state).toBe("waived");
    const calls = gh.calls();
    for (const path of ["/activity", "/actions/workflows/sync-waiver.yml/runs", "/timeline"]) {
      expect(calls.find((call) => call.includes(path))).toContain("--paginate");
    }
  });
});

describe("the status on the pull request", () => {
  it("is written once, and again only when it changes", () => {
    const { report, gh, head } = approvedSync();
    const first = report(at(24, "10:00"));
    expect(first.code).toBe(1);
    expect(first.state).toBe("waiting");
    expect(gh.posted()).toEqual([
      {
        sha: head,
        state: "pending",
        context: "Sync cooldown",
        description:
          "Cooling down until 2026-11-25 14:55 UTC (approved 2026-11-23 14:55 UTC). Expected. Not a CI check.",
        target_url: "",
      },
    ]);
    // An hour later it says the same: nothing is written.
    expect(report(at(24, "11:00")).state).toBe("waiting");
    expect(gh.posted()).toHaveLength(1);
    // It turns green by itself once the hours are over.
    const green = report(at(25, "15:43"), ["pull-request", "7"], {
      SYNC_COOLDOWN_RUN_URL: "https://github.example/run/1",
    });
    expect(green.code).toBe(0);
    expect(gh.posted()).toHaveLength(2);
    expect(gh.posted()[1]).toMatchObject({
      state: "success",
      target_url: "https://github.example/run/1",
    });
  });

  it("gives a sync branch no status before it is approved, so the review that approves it sees none", () => {
    const { report, gh, head } = approvedSync();
    gh.pull(7, { head, ref: SYNC, labels: [] });
    gh.labelEvents(7, []);
    const open = report(at(23, "15:00"));
    expect(open.state).toBe("not-approved");
    expect(gh.posted()).toEqual([]);
    // Nor on hold, nor while GitHub's push record is behind.
    gh.pull(7, { head, ref: SYNC, labels: ["sync-hold"] });
    expect(report(at(23, "15:00")).state).toBe("held");
    gh.pull(7, { head, ref: SYNC, labels: [] });
    gh.pushes(SYNC, []);
    expect(report(at(23, "15:00")).state).toBe("unsettled");
    expect(gh.posted()).toEqual([]);
  });

  it("gives a moved head no status either, until it is approved again", () => {
    const { report, gh, head } = approvedSync();
    gh.pushes(SYNC, [[at(24, "09:00"), head]]);
    expect(report(at(24, "10:00")).state).toBe("head-moved");
    expect(gh.posted()).toEqual([]);
    gh.labelEvents(7, [
      [APPROVED, "labeled", "sync-approved"],
      [at(24, "11:00"), "unlabeled", "sync-approved"],
      [at(24, "11:01"), "labeled", "sync-approved"],
    ]);
    expect(report(at(24, "11:05")).state).toBe("waiting");
    expect(gh.posted()).toHaveLength(1);
    expect(gh.posted()[0].description).toContain("Cooling down until 2026-11-26 11:01 UTC");
  });

  it("keeps a head that has the status told the truth", () => {
    const { report, gh, head } = approvedSync();
    report(at(24, "10:00"));
    // A hold.
    gh.pull(7, { head, ref: SYNC, labels: ["sync-approved", "sync-hold"] });
    report(at(24, "11:00"));
    // The approval taken off.
    gh.pull(7, { head, ref: SYNC, labels: [] });
    report(at(24, "12:00"));
    expect(gh.posted().map((status) => [status.state, status.description])).toEqual([
      [
        "pending",
        "Cooling down until 2026-11-25 14:55 UTC (approved 2026-11-23 14:55 UTC). Expected. Not a CI check.",
      ],
      [
        "pending",
        "On hold (label sync-hold). The 48 hours since the approval end 2026-11-25 14:55 UTC. Not a CI check.",
      ],
      [
        "pending",
        "Not approved yet: the 48 hours start when sync-approved is applied. Not a CI check.",
      ],
    ]);
  });

  it("tells any other branch that carries upstream commits at once", () => {
    const repo = fork();
    const gh = github();
    repo.upstreamCommit();
    repo.git("checkout", "--quiet", "-b", "codeden/bring-upstream");
    repo.git("merge", "--quiet", "--no-ff", "up", "-m", "Merge upstream");
    const head = repo.git("rev-parse", "HEAD");
    repo.git("checkout", "--quiet", "harden");
    gh.pull(9, { head, ref: "codeden/bring-upstream" });
    gh.pushes("codeden/bring-upstream", [[at(23), head]]);
    const result = repo.run(
      "sync-cooldown-report.sh",
      ["pull-request", "9", "--upstream-ref", "up", "--target-ref", "harden"],
      { ...gh.env, SYNC_COOLDOWN_NOW: at(24) },
    );
    expect(result.code).toBe(1);
    expect(gh.posted()).toMatchObject([
      {
        sha: head,
        state: "pending",
        description:
          "Not approved yet: the 48 hours start when sync-approved is applied. Not a CI check.",
      },
    ]);
  });

  it("links a waived one to the approved run", () => {
    const { report, gh, upstream, head } = approvedSync();
    const id = gh.waiverRun({ upstream, pullRequest: 7, commit: head, started: at(24, "09:00") });
    report(at(24, "10:00"), ["pull-request", "7"], {
      SYNC_COOLDOWN_RUN_URL: "https://github.example/run/1",
    });
    expect(gh.posted()[0]).toMatchObject({
      state: "success",
      description: "Cooldown waived by the owner (approved by example, 2026-11-24 09:00 UTC).",
      target_url: `https://github.example/runs/${id}`,
    });
  });

  it("goes over every open pull request, and writes none on one that brings no upstream commits", () => {
    const { report, gh, repo, head } = approvedSync();
    repo.git("checkout", "--quiet", "-b", "feature/x", "harden");
    const feature = repo.commit("feature.txt", "feat: ours");
    repo.git("checkout", "--quiet", "harden");
    gh.pull(8, { head: feature, ref: "feature/x" });
    gh.openPulls([{ number: 7 }, { number: 8 }]);
    const result = report(at(24, "10:00"), ["all"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`#7 ${SYNC} @ ${head}: waiting (pending).`);
    expect(result.out).not.toContain("#8");
    expect(gh.posted().map((status) => status.sha)).toEqual([head]);
  });

  it("says so when no pull request brings upstream commits", () => {
    const { report, gh } = approvedSync();
    gh.openPulls([]);
    const result = report(at(24), ["all"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("No open pull request into harden brings upstream commits.");
    expect(gh.posted()).toEqual([]);
  });

  it("warns about a pull request it can't evaluate or report, does the others, and does not fail the hourly run", () => {
    const { report, gh, head } = approvedSync();
    gh.openPulls([{ number: 6 }, { number: 7 }]);
    const result = report(at(24, "10:00"), ["all"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      "::warning::The cooldown of pull request #6 could not be evaluated",
    );
    expect(gh.posted().map((status) => status.sha)).toEqual([head]);

    const second = approvedSync();
    second.gh.openPulls([{ number: 7 }]);
    second.gh.fail("POST repos/[^ ]+/statuses/");
    const unwritten = second.report(at(24, "10:00"), ["all"]);
    expect(unwritten.code).toBe(0);
    expect(unwritten.out).toContain('::warning::A "Sync cooldown" status could not be written');
  });

  it("fails the hourly run when the pull requests can't be listed: then the workflow is broken", () => {
    const { report, gh } = approvedSync();
    gh.fail("pulls\\?state=open");
    const result = report(at(24), ["all"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("the open pull requests couldn't be listed");
  });

  it("keeps the verdict for the merge job when only the status can't be written", () => {
    const { report, gh } = approvedSync();
    gh.fail("POST repos/[^ ]+/statuses/");
    const result = report(at(26));
    expect(result.code).toBe(0);
    expect(result.state).toBe("satisfied");
    expect(result.err).toContain("the status of #7 couldn't be written");
    // And is not a yes when the rule itself can't be asked.
    gh.fail("timeline");
    const unknown = report(at(26));
    expect(unknown.code).toBe(2);
    expect(unknown.state).toBe("unknown");
  });

  it("asks the repository it runs for", () => {
    const { report, gh } = approvedSync();
    report(at(24));
    expect(gh.calls().every((call) => call.includes(`repos/${REPO}/`))).toBe(true);
  });
});
