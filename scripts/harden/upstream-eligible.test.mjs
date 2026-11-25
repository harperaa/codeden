// The quarantine of upstream commits (upstream-eligible.sh), in a scratch repository against
// a stub `gh`: no network, and the clock is the test's. The scratch repository has no remote
// at all, so nothing could be taken from one.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { at, fork, github, pathWithoutGh, script, verdict } from "./test-support/cooldown.mjs";
import { sh } from "./test-support/scratch.mjs";

const UPSTREAM = "example/upstream";
const BRANCH = "trunk";
/** Every test asks at this moment unless it says otherwise: 48 hours ago is the 23rd, 12:00. */
const NOW = at(25, "12:00");

/**
 * A fork whose working branch has upstream's first commit (`base`), and GitHub's record of
 * upstream's branch, which each test writes with `gh.branch(BRANCH, …)`.
 */
function quarantine() {
  const repo = fork();
  const gh = github();
  const base = repo.git("rev-parse", "up");
  const env = {
    ...gh.env,
    UPSTREAM_REPO: UPSTREAM,
    UPSTREAM_BRANCH: BRANCH,
    FORK_CONFIG_NO_GH: "1",
  };
  const ask = (args, now = NOW, extra = {}) => {
    const result = repo.run("upstream-eligible.sh", [...args, "--target-ref", repo.branch], {
      ...env,
      SYNC_COOLDOWN_NOW: now,
      ...extra,
    });
    return { ...result, ...verdict(result.out) };
  };
  return {
    repo,
    gh,
    base,
    latest: (now, extra) => ask(["latest"], now, extra),
    check: (commit, now) => ask(["check", commit], now),
  };
}

/** The helper's own lines, without its comments. */
const code = readFileSync(script("upstream-eligible.sh"), "utf8")
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

describe("the quarantine: which upstream commit may be synced", () => {
  it("says there is nothing new when the working branch has upstream's tip", () => {
    const { gh, base, latest } = quarantine();
    gh.branch(BRANCH, [[at(20), base, "branch_creation"]]);
    const result = latest();
    expect(result.code).toBe(1);
    expect(result.state).toBe("up-to-date");
    expect(result.short).toBe(
      `No new upstream commits: the working branch has upstream's tip ${base.slice(0, 8)}.`,
    );
    expect(result.commit).toBe("");
    expect(result.tip).toBe(base);
  });

  it("names nothing while the only new commit is younger than 48 hours, and says when", () => {
    const { repo, gh, base, latest } = quarantine();
    const young = repo.upstreamCommit();
    gh.branch(BRANCH, [
      [at(24, "18:00"), young],
      [at(20), base],
    ]);
    const result = latest();
    expect(result.code).toBe(1);
    expect(result.state).toBe("none");
    expect(result.short).toBe(
      "No upstream commit is out of quarantine; next eligible 2026-11-26 18:00 UTC.",
    );
    expect(result.next).toBe("2026-11-26T18:00:00Z");
    expect(result.commit).toBe("");
    expect(result.newest).toBe(base);
  });

  it("names the older commit when the tip is too young, asking GitHub for metadata only", () => {
    const { repo, gh, base, latest } = quarantine();
    const old = repo.upstreamCommit("upstream-2.txt", "fix: upstream two");
    const young = repo.upstreamCommit("upstream-3.txt", "feat: upstream three");
    gh.branch(BRANCH, [
      [at(25, "08:00"), young, "pr_merge"],
      [at(22, "09:00"), old, "pr_merge"],
      [at(20), base],
    ]);
    const result = latest();
    expect(result.code).toBe(0);
    expect(result.state).toBe("eligible");
    expect(result.commit).toBe(old);
    expect(result.newest).toBe(old);
    expect(result.pushed).toBe("2026-11-22T09:00:00Z");
    expect(result.tip).toBe(young);
    expect(result.next).toBe("2026-11-27T08:00:00Z");
    expect(result.short).toBe(
      `Upstream ${old.slice(0, 8)} is out of quarantine: on ${BRANCH} since 2026-11-22 09:00 UTC. 1 newer update is still in quarantine and comes out 2026-11-27 08:00 UTC.`,
    );
    expect(result.finding).toBe("");
    // Two questions, both about the configured upstream's branch, and nothing else.
    expect(gh.calls()).toEqual([
      expect.stringMatching(new RegExp(`^api repos/${UPSTREAM}/git/ref/heads/${BRANCH} --jq `)),
      expect.stringMatching(
        new RegExp(
          `^api --method GET repos/${UPSTREAM}/activity -f ref=refs/heads/${BRANCH} -f direction=desc -f per_page=100 --jq `,
        ),
      ),
    ]);
  });

  it("lets a commit through at exactly 48 hours, and not a second sooner", () => {
    const { repo, gh, base, latest } = quarantine();
    const commit = repo.upstreamCommit();
    gh.branch(BRANCH, [
      [at(23, "12:00"), commit],
      [at(20), base],
    ]);
    const early = latest("2026-11-25T11:59:59Z");
    expect(early.state).toBe("none");
    expect(early.next).toBe("2026-11-25T12:00:00Z");
    const onTime = latest("2026-11-25T12:00:00Z");
    expect(onTime.code).toBe(0);
    expect(onTime.state).toBe("eligible");
    expect(onTime.commit).toBe(commit);
    expect(onTime.next).toBe("");
  });

  it("goes by when the commit arrived, not by the date written in it", () => {
    const { repo, gh, base, latest, check } = quarantine();
    const dated = "2026-11-01T00:00:00Z";
    repo.git("checkout", "--quiet", "up");
    writeFileSync(join(repo.dir, "backdated.txt"), "x\n");
    repo.git("add", "backdated.txt");
    sh(repo.dir, "git", ["commit", "--quiet", "-m", "fix: dated three weeks ago"], {
      GIT_AUTHOR_DATE: dated,
      GIT_COMMITTER_DATE: dated,
    });
    const backdated = repo.git("rev-parse", "HEAD");
    repo.git("checkout", "--quiet", repo.branch);
    expect(repo.git("show", "-s", "--format=%aI %cI", backdated)).toMatch(
      /^2026-11-01T.* 2026-11-01T/,
    );
    // Pushed six hours ago.
    gh.branch(BRANCH, [
      [at(25, "06:00"), backdated],
      [at(20), base],
    ]);
    const result = latest();
    expect(result.code).toBe(1);
    expect(result.state).toBe("none");
    expect(result.commit).toBe("");
    const asked = check(backdated);
    expect(asked.code).toBe(1);
    expect(asked.state).toBe("not-eligible");
    expect(asked.short).toBe(
      `Upstream ${backdated.slice(0, 8)} is still in quarantine until 2026-11-27 06:00 UTC.`,
    );
    // No commit was asked about: its dates were never read.
    expect(gh.calls().filter((call) => /commits/.test(call))).toEqual([]);
  });

  it("refuses everything when the history was rewritten inside the quarantine, loudly", () => {
    const { repo, gh, base, latest, check } = quarantine();
    const old = repo.upstreamCommit("upstream-2.txt", "fix: upstream two");
    const forced = "f".repeat(40);
    const after = "a".repeat(40);
    gh.branch(BRANCH, [
      [at(25, "09:00"), after],
      [at(24, "20:00"), forced, "force_push", old],
      [at(21), old],
      [at(20), base],
    ]);
    const result = latest();
    expect(result.code).toBe(1);
    expect(result.state).toBe("rewritten");
    expect(result.commit).toBe("");
    expect(result.newest).toBe("");
    expect(result.next).toBe("2026-11-26T20:00:00Z");
    expect(result.short).toBe(
      "Upstream's history was rewritten inside the quarantine (2026-11-24 20:00 UTC, force_push): nothing is eligible before 2026-11-26 20:00 UTC.",
    );
    expect(result.finding).toContain(`force_push: ${old} became ${forced}`);
    expect(result.finding).toContain("Tell the owner");
    // Not even the commit that had waited long enough before the rewrite.
    expect(check(old).state).toBe("rewritten");

    // Once the rewrite itself is 48 hours old, what it left is eligible, and it is still said.
    const later = latest(at(26, "20:00"));
    expect(later.state).toBe("eligible");
    expect(later.commit).toBe(forced);
    expect(later.finding).toContain("was rewritten 2026-11-24 20:00 UTC (force_push");
  });

  it("answers unknown, never eligible, when GitHub can't say", () => {
    const unknown = (result) => {
      expect(result.code).toBe(2);
      expect(result.state).toBe("unknown");
      expect(result.commit).toBe("");
      expect(result.short).toBe("The quarantine could not be evaluated; nothing is eligible.");
      return result.detail;
    };
    const setup = () => {
      const q = quarantine();
      const old = q.repo.upstreamCommit();
      return {
        ...q,
        old,
        rows: [
          [at(21), old],
          [at(20), q.base],
        ],
      };
    };
    {
      // An outage, of either question.
      const { gh, rows, latest } = setup();
      gh.branch(BRANCH, rows);
      expect(latest().state).toBe("eligible");
      gh.fail("activity");
      expect(unknown(latest())).toContain("GitHub did not answer");
      gh.fail("git/ref");
      expect(unknown(latest())).toContain("GitHub did not answer");
    }
    {
      // No `gh` at all.
      const { gh, rows, latest } = setup();
      gh.branch(BRANCH, rows);
      expect(unknown(latest(NOW, { PATH: pathWithoutGh() }))).toContain("gh) is not on PATH");
    }
    {
      // A record that does not reach back 48 hours.
      const { gh, old, latest } = setup();
      gh.branch(BRANCH, [[at(25, "06:00"), old]]);
      expect(unknown(latest())).toContain("has no update that is 48 hours old or older");
    }
    {
      // A record that is not at the branch's tip.
      const { gh, rows, latest } = setup();
      gh.branch(BRANCH, rows, "9".repeat(40));
      expect(unknown(latest())).toContain("is not at the branch's tip");
    }
    {
      // An update missing between two others, inside the quarantine.
      const { gh, old, base, latest } = setup();
      gh.branch(BRANCH, [
        [at(25, "06:00"), "b".repeat(40), "push", "c".repeat(40)],
        [at(21), old],
        [at(20), base],
      ]);
      expect(unknown(latest())).toContain("does not fit together");
    }
    {
      // A time that can't be read.
      const { gh, old, base, latest } = setup();
      gh.branch(BRANCH, [
        ["yesterday", old],
        [at(20), base],
      ]);
      expect(unknown(latest())).toContain("a shape this script does not know");
    }
    {
      // A fork that has not said which upstream it follows: its configuration's own exit must
      // not read as an answer.
      const { repo, gh, rows } = setup();
      gh.branch(BRANCH, rows);
      repo.git("remote", "add", "origin", "https://github.com/example/example-harden.git");
      const result = repo.run("upstream-eligible.sh", ["latest", "--target-ref", repo.branch], {
        ...gh.env,
        FORK_CONFIG_NO_GH: "1",
        SYNC_COOLDOWN_NOW: NOW,
      });
      expect(unknown({ ...result, ...verdict(result.out) })).toContain("configuration");
      expect(gh.calls()).toEqual([]);
    }
  });

  it("checks one commit: the newest out of quarantine and its history pass, nothing newer does", () => {
    const { repo, gh, base, check } = quarantine();
    const older = repo.upstreamCommit("upstream-2.txt", "fix: upstream two");
    const newest = repo.upstreamCommit("upstream-3.txt", "feat: upstream three");
    const young = repo.upstreamCommit("upstream-4.txt", "feat: upstream four");
    gh.branch(BRANCH, [
      [at(25, "08:00"), young],
      // One push brought both commits: only its tip is on record.
      [at(22, "09:00"), newest],
      [at(20), base],
    ]);
    for (const commit of [newest, older, base]) {
      const result = check(commit);
      expect(result.code).toBe(0);
      expect(result.state).toBe("eligible");
      expect(result.commit).toBe(commit);
      expect(result.newest).toBe(newest);
    }
    const tooYoung = check(young);
    expect(tooYoung.code).toBe(1);
    expect(tooYoung.state).toBe("not-eligible");
    expect(tooYoung.commit).toBe("");
    // A commit that is not upstream's at all (the working branch's own).
    const own = check(repo.git("rev-parse", repo.branch));
    expect(own.state).toBe("not-eligible");
    expect(own.short).toContain("it is not in the history of");

    // The newest commit out of quarantine is not in this clone: its history can't be read.
    gh.branch(BRANCH, [
      [at(25, "08:00"), young],
      [at(22, "09:00"), "e".repeat(40)],
      [at(20), base],
    ]);
    const blind = check(older);
    expect(blind.code).toBe(2);
    expect(blind.state).toBe("unknown");
    expect(blind.newest).toBe("e".repeat(40));
    expect(blind.detail).toContain("Take exactly that commit by its id");
  });

  it("asks for the week when a hundred updates are all inside the quarantine", () => {
    const { repo, gh, base, latest } = quarantine();
    const old = repo.upstreamCommit();
    const newest = Date.parse(at(25, "11:00"));
    const busy = Array.from({ length: 120 }, (_, i) => [
      new Date(newest - i * 60_000).toISOString().replace(".000Z", "Z"),
      (1000 + i).toString(16).padStart(40, "0"),
    ]);
    gh.branch(BRANCH, [...busy, [at(22), old], [at(20), base]]);
    const result = latest();
    expect(result.state).toBe("eligible");
    expect(result.commit).toBe(old);
    expect(result.next).toBe("2026-11-27T09:01:00Z");
    expect(gh.calls().at(-1)).toMatch(
      new RegExp(
        `^api --paginate --method GET repos/${UPSTREAM}/activity -f ref=refs/heads/${BRANCH} -f direction=desc -f per_page=100 -f time_period=week --jq `,
      ),
    );
  });

  it("takes nothing of upstream's: no transfer, no checkout, nothing run", () => {
    // Its git commands only read this clone: none transfers, checks out or writes anything.
    const commands = [...code.matchAll(/\bgit ([a-z-]+)/g)].map((match) => match[1]);
    expect([...new Set(commands)].sort()).toEqual(["cat-file", "merge-base", "rev-parse"]);
    // No other program that could download or run something.
    expect(
      code.match(/\b(curl|wget|ssh|scp|tar|unzip|npm|pnpm|npx|node|corepack|eval|source)\b/g),
    ).toBeNull();
    // The only code it loads is the cooldown's and the fork's configuration, beside it.
    const loaded = (code.match(/^\s*\. .*$/gm) ?? []).map(
      (line) => /^\. "\$\{script_dir\}\/([a-z-]+\.sh)"$/.exec(line)?.[1],
    );
    expect(loaded).toEqual(["sync-cooldown.sh", "fork-config.sh"]);
    // GitHub is asked through one function, about two endpoints of the configured upstream.
    expect(code.match(/\bgh\b/g)).toBeNull();
    const asked = (code.match(/cd_gh api [^\n]*/g) ?? []).map((call) =>
      /"repos\/\$\{UPSTREAM_REPO\}\/([^"]+)"/.exec(call)?.[1]?.replace(/\$\{([A-Z_]+)\}/, "<$1>"),
    );
    expect(asked).toEqual(["git/ref/heads/<UPSTREAM_BRANCH>", "activity", "activity"]);
  });

  it("has its hours beside the cooldown's, under a name of its own", () => {
    const constant = (name) =>
      sh(process.cwd(), "bash", ["-c", `. "${script("sync-cooldown.sh")}"; printf '%s' "$${name}"`])
        .out;
    expect(constant("QUARANTINE_HOURS")).toBe("48");
    expect(constant("COOLDOWN_HOURS")).toBe("48");
    // The helper writes no number of hours itself, and reads no clock but the cooldown's.
    expect(code).toContain("QUARANTINE_HOURS * 3600");
    expect(code.match(/\b48\b|\$\(date\b|\bdate [-+]|_NOW\b/g)).toBeNull();
    expect(code.match(/\bcd_now\b/g)).toHaveLength(1);
  });
});
