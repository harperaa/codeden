// The "Waive sync cooldown" workflow: its two steps (sync-waiver.sh) in a scratch repository
// against a stub `gh`, and the rules the workflow file states, read from the file as written.
// The workflow can't be run before it is merged; nothing here touches GitHub.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { at, fork, github, script } from "./test-support/cooldown.mjs";
import { sh } from "./test-support/scratch.mjs";
import {
  D,
  expression,
  jobs,
  marked,
  permissions,
  runBlocks,
  SCRIPT,
  triggers,
  workflowFile,
} from "./test-support/workflow.mjs";

/** The two inputs, as the workflow's `run-name` reads them. */
const UPSTREAM_INPUT = `${D}{{ inputs.upstream }}`;
const PULL_REQUEST_INPUT = `${D}{{ inputs.pull-request || 'none' }}`;
const COMMIT_INPUT = `${D}{{ inputs.commit }}`;

const SYNC = "sync/2026-11-23";
/** The environment as the owner sets it up: the owner reviews, only the working branch, no bypass. */
const GATE = {
  protection_rules: [
    { type: "branch_policy" },
    {
      type: "required_reviewers",
      prevent_self_review: false,
      reviewers: [{ type: "User", reviewer: { login: "example" } }],
    },
  ],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  can_admins_bypass: false,
};
const ONLY = (branch) => [{ name: branch, type: "branch" }];

/** A fork with an open sync pull request #7, approved an hour ago, and the gate in place. */
function request({ branch = "harden" } = {}) {
  const repo = fork(branch);
  const gh = github();
  const upstream = repo.upstreamCommit();
  const head = repo.syncBranch(SYNC);
  gh.pull(7, { head, ref: SYNC, labels: ["sync-approved"], base: branch });
  gh.labelEvents(7, [[at(24, "09:00"), "labeled", "sync-approved"]]);
  gh.pushes(SYNC, [[at(24, "08:00"), head, "branch_creation"]]);
  gh.environment(GATE, ONLY(branch));
  const files = mkdtempSync(join(tmpdir(), "codeharden-waiver-test-"));
  writeFileSync(join(files, "summary"), "");
  const run = (mode, args, env = {}) =>
    repo.run("sync-waiver.sh", [mode, ...args, "--upstream-ref", "up", "--target-ref", branch], {
      ...gh.env,
      SYNC_COOLDOWN_NOW: at(24, "10:00"),
      HARDEN_BRANCH: branch,
      GITHUB_REF: `refs/heads/${branch}`,
      GITHUB_STEP_SUMMARY: join(files, "summary"),
      ...env,
    });
  const forPull = ["--upstream", upstream, "--pull-request", "7", "--commit", head];
  const check = (args = forPull, env) => run("check", args, env);
  const confirm = (args, env) => run("confirm", args, env);
  const read = (name) => readFileSync(join(files, name), "utf8");
  return { repo, gh, upstream, head, check, confirm, read, forPull };
}

describe("a waiver request, before anyone is asked", () => {
  it("passes for the upstream commit an open pull request brings at its head, and says what approving would waive", () => {
    const { check, read, upstream, head } = request();
    const result = check();
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    const summary = read("summary");
    expect(summary).toContain(
      `lets **upstream commit ${upstream}, brought by pull request #7 at its head ${head}** ship before its 48 hours are over`,
    );
    expect(summary).toContain("The waiver is for that head only");
    expect(summary).toContain(
      "Without the waiver: sync-approved was applied 2026-11-24 09:00 UTC. The 48 hours end 2026-11-26 09:00 UTC",
    );
    expect(summary).toContain("Only an approval by the repository's owner (example) counts.");
    expect(result.out).toContain("### Waive the 48-hour sync cooldown");
  });

  it("is for the pull request's head as it is now, and for no other commit", () => {
    const { check, repo, upstream, head } = request();
    const other = repo.git("rev-parse", "harden");
    const result = check(["--upstream", upstream, "--pull-request", "7", "--commit", other]);
    expect(result.code).toBe(1);
    expect(result.out).toContain(`Pull request #7's head is ${head}, not ${other}.`);
  });

  it("passes without a pull request for the commit of the branch that brought the upstream commit in", () => {
    const { check, repo, read, upstream } = request();
    repo.git("merge", "--quiet", "--no-ff", "up", "-m", "Merge upstream by hand");
    const landing = repo.git("rev-parse", "HEAD");
    const result = check(["--upstream", upstream, "--pull-request", "", "--commit", landing]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(read("summary")).toContain(
      `No pull request: the waiver is for the upstream commits that the commit \`${landing.slice(0, 8)}\` brought into \`harden\`, and for nothing else.`,
    );
    // Not for a commit that is not on the branch, or that brings another upstream commit.
    const elsewhere = repo.git("rev-parse", SYNC);
    expect(
      check(["--upstream", upstream, "--pull-request", "", "--commit", elsewhere]).out,
    ).toContain(`${elsewhere} is not a commit of harden.`);
    const before = repo.git("rev-parse", "harden~1");
    expect(check(["--upstream", upstream, "--pull-request", "", "--commit", before]).out).toContain(
      `The commit ${before} brings upstream up to`,
    );
  });

  it("passes for a pull request that was merged before its hours were over", () => {
    const { check, gh, head } = request();
    gh.pull(7, { head, ref: SYNC, merged: at(24, "09:30") });
    expect(check().code).toBe(0);
  });

  it("refuses when the environment is not a gate", () => {
    const refusal = (environment, policies, env) => {
      const { check, gh } = request();
      if (environment === null) gh.fail("environments/sync-waiver$");
      else gh.environment(environment, policies);
      const result = check(undefined, env);
      expect(result.code).toBe(1);
      expect(result.out).toContain('::error::The environment "sync-waiver" is not a gate:');
      expect(result.out).toContain("Nothing is recorded.");
      return result.out;
    };
    expect(refusal(null)).toContain("it does not exist, or can't be read");
    expect(
      refusal({ ...GATE, protection_rules: [{ type: "branch_policy" }] }, ONLY("harden")),
    ).toContain("it has no required reviewers");
    expect(
      refusal(
        { ...GATE, protection_rules: [{ type: "required_reviewers", reviewers: [] }] },
        ONLY("harden"),
      ),
    ).toContain("it has no required reviewers");
    expect(refusal({ ...GATE, deployment_branch_policy: null })).toContain(
      "it lets every branch use it",
    );
    expect(
      refusal({
        ...GATE,
        deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
      }),
    ).toContain("it lets every protected branch use it");
    expect(refusal(GATE, [...ONLY("harden"), { name: "release/*", type: "branch" }])).toContain(
      "it may be used by: branch harden, branch release/*; only the branch harden should be allowed",
    );
    expect(refusal(GATE, [{ name: "harden", type: "tag" }])).toContain(
      "it may be used by: tag harden",
    );
    expect(refusal(GATE, [])).toContain("it may be used by: no branch at all");
    expect(refusal({ ...GATE, can_admins_bypass: true }, ONLY("harden"))).toContain(
      "it lets administrators start its jobs without a review",
    );
    // A field GitHub stops sending is not read as "off".
    const { can_admins_bypass: _gone, ...unsaid } = GATE;
    expect(refusal(unsaid, ONLY("harden"))).toContain(
      "it lets administrators start its jobs without a review",
    );
    // Several problems are all named.
    expect(
      refusal({ protection_rules: [], deployment_branch_policy: null, can_admins_bypass: true }),
    ).toMatch(/no required reviewers.*; it lets every branch use it.*; it lets administrators/);
  });

  it("refuses when none of the environment's reviewers may waive", () => {
    const { check, gh } = request();
    const others = {
      ...GATE,
      protection_rules: [
        {
          type: "required_reviewers",
          reviewers: [
            { type: "User", reviewer: { login: "a-maintainer" } },
            { type: "Team", reviewer: { slug: "everyone" } },
          ],
        },
      ],
    };
    gh.environment(others, ONLY("harden"));
    const result = check();
    expect(result.code).toBe(1);
    expect(result.out).toContain(
      "none of its reviewers (a-maintainer) may waive: that is the repository's owner (example)",
    );
    // A repository of an organization names who may.
    expect(check(undefined, { SYNC_WAIVER_APPROVERS: "A-Maintainer" }).code).toBe(0);
  });

  it("refuses a run that was not started on the working branch", () => {
    const { check } = request();
    const result = check(undefined, { GITHUB_REF: "refs/heads/some-branch" });
    expect(result.code).toBe(1);
    expect(result.out).toContain(
      "A waiver must be started on harden; this run was started on refs/heads/some-branch.",
    );
    expect(check(undefined, { GITHUB_REF: "refs/tags/harden" }).code).toBe(1);
  });

  it("refuses a malformed request before it asks anything", () => {
    const { check, gh, upstream, head } = request();
    for (const bad of [
      upstream.slice(0, 12),
      upstream.toUpperCase(),
      `${upstream} `,
      "",
      `${upstream}, pull request 7`,
    ]) {
      expect(check(["--upstream", bad, "--pull-request", "7", "--commit", head]).out).toContain(
        "The upstream commit must be its full id",
      );
    }
    for (const bad of [head.slice(0, 12), "", `${head}, commit ${head}`]) {
      expect(check(["--upstream", upstream, "--pull-request", "7", "--commit", bad]).out).toContain(
        "The commit must be its full id",
      );
    }
    for (const bad of ["seven", "0", "7 8", "-1", "#7"]) {
      expect(
        check(["--upstream", upstream, "--pull-request", bad, "--commit", head]).out,
      ).toContain("The pull request must be its number");
    }
    expect(gh.calls()).toEqual([]);
  });

  it("refuses an upstream commit that is not upstream's, and a pull request that brings another one", () => {
    const { check, repo, upstream, head } = request();
    const ours = repo.git("rev-parse", "harden");
    const notUpstream = check(["--upstream", ours, "--pull-request", "7", "--commit", head]);
    expect(notUpstream.code).toBe(1);
    expect(notUpstream.out).toContain(`${ours} is not a commit of leonvanzyl/codeden's main`);
    expect(
      check(["--upstream", "e".repeat(40), "--pull-request", "7", "--commit", head]).code,
    ).toBe(1);

    const older = repo.git("rev-parse", "up~1");
    const other = check(["--upstream", older, "--pull-request", "7", "--commit", head]);
    expect(other.code).toBe(1);
    expect(other.out).toContain(
      `Pull request #7 brings upstream up to ${upstream}, not to ${older}.`,
    );
  });

  it("refuses a pull request into another branch, a closed one, and one that has already waited", () => {
    const elsewhere = request();
    elsewhere.gh.pull(7, { head: elsewhere.head, ref: SYNC, base: "release-1" });
    expect(elsewhere.check().out).toContain("Pull request #7 is into release-1, not into harden.");

    const closed = request();
    const pr = closed.gh.pull(7, { head: closed.head, ref: SYNC });
    writeFileSync(
      join(closed.gh.env.GH_STATE, "pulls/7.json"),
      JSON.stringify({ ...pr, state: "closed" }),
    );
    expect(closed.check().out).toContain("Pull request #7 was closed without being merged.");

    const waited = request();
    const result = waited.check(undefined, { SYNC_COOLDOWN_NOW: at(27) });
    expect(result.code).toBe(1);
    expect(result.out).toContain(
      "Pull request #7 has waited out its cooldown (approved 2026-11-24 09:00 UTC). There is nothing to waive.",
    );

    const unreadable = request();
    unreadable.gh.fail("pulls/7");
    expect(unreadable.check().out).toContain("Pull request #7 couldn't be read");
  });

  it("works in a fork whose working branch has another name", () => {
    const { check } = request({ branch: "trunk" });
    expect(check().code).toBe(0);
    expect(check(undefined, { GITHUB_REF: "refs/heads/harden" }).out).toContain(
      "A waiver must be started on trunk",
    );
  });
});

describe("a waiver, after the approval", () => {
  /** A request whose run GitHub recorded as approved (or as `run` says). */
  function approved(run = {}) {
    const all = request();
    const id = all.gh.waiverRun({
      upstream: all.upstream,
      pullRequest: 7,
      commit: all.head,
      started: at(24, "10:00"),
      ...run,
    });
    const confirm = (env = {}) => all.confirm(all.forPull, { GITHUB_RUN_ID: String(id), ...env });
    return { ...all, confirm };
  }

  it("says who approved it", () => {
    const { confirm, read, upstream, head } = approved();
    const result = confirm();
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(read("summary")).toContain("### Sync cooldown waived by the owner");
    expect(read("summary")).toContain(
      `Approved by **example**: upstream commit ${upstream}, brought by pull request #7 at its head ${head} may ship`,
    );
  });

  it("fails when GitHub recorded no approval for this run in the waiver environment", () => {
    for (const run of [
      { approvedBy: null },
      { approval: "rejected" },
      { environment: "release" },
    ]) {
      const result = approved(run).confirm();
      expect(result.code).toBe(1);
      expect(result.out).toContain(
        'GitHub has no record of a reviewer approving this run for the environment "sync-waiver", so it is not a waiver.',
      );
    }
    const unreadable = approved();
    unreadable.gh.fail("approvals");
    const result = unreadable.confirm();
    expect(result.code).toBe(1);
    expect(result.out).toContain("This run's review history couldn't be read");
  });

  it("fails when the one who approved may not waive", () => {
    const { confirm } = approved({ approvedBy: "someone-else" });
    const result = confirm();
    expect(result.code).toBe(1);
    expect(result.out).toContain(
      "This run was approved by someone-else, and only the repository's owner (example) may waive, so it is not a waiver.",
    );
    expect(confirm({ SYNC_WAIVER_APPROVERS: "someone-else" }).code).toBe(0);
  });

  it("fails when the pull request's head moved while the run waited", () => {
    const { confirm, gh, head } = approved();
    gh.pull(7, { head: "a".repeat(40), ref: SYNC, labels: ["sync-approved"] });
    const result = confirm();
    expect(result.code).toBe(1);
    expect(result.out).toContain(
      `Pull request #7's head moved while this run waited (${head} is now ${"a".repeat(40)}). Nothing is recorded`,
    );
  });

  it("fails outside a workflow run", () => {
    const { confirm } = approved();
    expect(confirm({ GITHUB_RUN_ID: "" }).out).toContain("This step runs in the workflow only.");
  });

  it("needs no pull request for a waiver that names none", () => {
    const all = request();
    const landing = all.repo.git("rev-parse", "harden");
    const id = all.gh.waiverRun({
      upstream: all.upstream,
      commit: landing,
      started: at(24, "10:00"),
    });
    const result = all.confirm(
      ["--upstream", all.upstream, "--pull-request", "", "--commit", landing],
      { GITHUB_RUN_ID: String(id) },
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      `Approved by **example**: upstream commit ${all.upstream}, brought by the commit ${landing} may ship`,
    );
  });
});

describe("the waiver workflow file", () => {
  const workflow = workflowFile("sync-waiver.yml");
  const report = workflowFile("sync-cooldown.yml");
  const all = jobs(workflow);
  const constant = (name) =>
    sh(process.cwd(), "bash", ["-c", `. "${script("sync-cooldown.sh")}"; printf '%s' "$${name}"`])
      .out;

  it("starts only when a person runs it", () => {
    const on = triggers(workflow);
    expect(on).toContain("workflow_dispatch:");
    expect(on).not.toMatch(
      /^\s+(push|pull_request|pull_request_target|schedule|release|workflow_run|workflow_call):/m,
    );
  });

  it("writes nothing: no job has a write permission, and it uses no action", () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    expect(Object.keys(all)).toEqual(["check", "waive"]);
    for (const job of Object.values(all)) {
      const granted = permissions(job);
      expect(granted).toEqual(["contents: read", "pull-requests: read", "actions: read"]);
    }
    expect(workflow).not.toMatch(/^\s*(- )?uses:/m);
    expect(workflow).not.toContain("secrets.");
  });

  it("waits for the approval in one job only, which runs after the check passed", () => {
    expect(all.waive).toMatch(/^ {4}environment: sync-waiver$/m);
    expect(all.waive).toMatch(/^ {4}needs: check$/m);
    expect(all.check).not.toMatch(/^\s+environment:/m);
    expect(constant("WAIVER_ENVIRONMENT")).toBe("sync-waiver");
  });

  it("passes its inputs to the script as data, never inside a script", () => {
    expect(runBlocks(workflow)).not.toContain("${{");
    for (const job of [all.check, all.waive]) {
      expect(job).toContain(expression("UPSTREAM", "inputs.upstream"));
      expect(job).toContain(expression("PULL_REQUEST", "inputs.pull-request"));
      expect(job).toContain(expression("COMMIT", "inputs.commit"));
    }
    expect(all.check).toContain(
      'check --upstream "$UPSTREAM" --pull-request "$PULL_REQUEST" --commit "$COMMIT"',
    );
    expect(all.waive).toContain(
      'confirm --upstream "$UPSTREAM" --pull-request "$PULL_REQUEST" --commit "$COMMIT"',
    );
    // Who may waive comes from the repository's own variable, never from an input.
    expect(workflow).toContain(expression("  SYNC_WAIVER_APPROVERS", "vars.SYNC_WAIVER_APPROVERS"));
    expect(workflow).not.toMatch(/inputs\.(approver|approvers|by)/);
  });

  it("titles its run with exactly the text the rule looks for", () => {
    const title = /^run-name: "(.*)"$/m.exec(workflow)?.[1];
    expect(title).toBe(
      `Waive sync cooldown: upstream ${UPSTREAM_INPUT}, pull request ${PULL_REQUEST_INPUT}, commit ${COMMIT_INPUT}`,
    );
    const upstream = "a".repeat(40);
    const commit = "b".repeat(40);
    const fill = (pullRequest) =>
      title
        .replace(UPSTREAM_INPUT, upstream)
        .replace(PULL_REQUEST_INPUT, pullRequest || "none")
        .replace(COMMIT_INPUT, commit);
    const wanted = (pullRequest) =>
      sh(process.cwd(), "bash", [
        "-c",
        `. "${script("sync-cooldown.sh")}"; cd_waiver_title "$1" "$2" "$3"`,
        "bash",
        upstream,
        pullRequest,
        commit,
      ]).out;
    expect(fill("7")).toBe(wanted("7"));
    expect(fill("")).toBe(wanted(""));
    expect(fill("")).toBe(
      `Waive sync cooldown: upstream ${upstream}, pull request none, commit ${commit}`,
    );
    // The rule finds the runs by this file's name and tells them by this workflow's name.
    expect(/^name: (.*)$/m.exec(workflow)?.[1]).toBe(constant("WAIVER_WORKFLOW_NAME"));
    expect(constant("WAIVER_WORKFLOW")).toBe("sync-waiver.yml");
    expect(report).toContain(`workflows: ["${constant("WAIVER_WORKFLOW_NAME")}"]`);
  });

  it("takes its scripts from the working branch, the same way in every job that runs them", () => {
    const blocks = [...marked(workflow, "harden-scripts"), ...marked(report, "harden-scripts")];
    expect(blocks).toHaveLength(3);
    expect(new Set(blocks).size).toBe(1);
    expect(blocks[0]).toContain(`git show "refs/sync/target:scripts/harden/${SCRIPT}"`);
    const names = /for script in (.+); do/.exec(blocks[0])?.[1].split(" ") ?? [];
    expect(names).toEqual([
      "fork-config.sh",
      "sync-cooldown.sh",
      "sync-cooldown-report.sh",
      "sync-waiver.sh",
    ]);
    for (const name of names)
      expect(readFileSync(script(name), "utf8").length).toBeGreaterThan(100);
    expect(workflow).not.toContain("actions/checkout");
  });
});
