// The README's steps for a sync by hand ("How syncs get reviewed and merged"), run as they are
// written: in a scratch repository, against a stub `gh`, with a `git` that records every fetch
// and push and runs neither. On any answer of the quarantine helper that is not a yes they must
// fetch nothing of upstream's and push nothing. An empty commit id is not harmless to git: it
// fetches the remote's HEAD and deletes the branch the push names.
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { at, fork, github } from "./test-support/cooldown.mjs";
import { sh } from "./test-support/scratch.mjs";

const README = fileURLToPath(new URL("../../README.md", import.meta.url));
const HARDEN = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
const UPSTREAM = "example/upstream";
const FORK = "example/example-harden";
const NOW = at(25, "12:00");
/** The one fetch every run makes: the fork's own working branch. */
const OWN = "[fetch][origin][harden]";
/** The shells a reader pastes into: bash and sh everywhere, zsh where this machine has it. */
const SHELLS = ["bash", "sh", "zsh"].filter(
  (shell) => sh(tmpdir(), "/bin/sh", ["-c", `command -v ${shell}`]).code === 0,
);

/** The steps as the README has them: the first `sh` block of that paragraph. */
function readmeSteps() {
  const text = readFileSync(README, "utf8");
  const from = text.indexOf("**How syncs get reviewed and merged.**");
  expect(from).toBeGreaterThan(0);
  const block = /```sh\n([\s\S]*?)\n```/.exec(text.slice(from))?.[1] ?? "";
  expect(block).toContain("scripts/harden/upstream-eligible.sh latest");
  return block;
}

/** What the pull request used to say, kept to show that these tests see the hole it had. */
const PIPED = [
  "git fetch origin harden",
  "commit=$(scripts/harden/upstream-eligible.sh latest | sed -n 's/^commit: //p')",
  'git fetch --no-tags https://github.com/<the repository you follow> "$commit"',
  'git push origin "$commit":refs/heads/sync/2026-01-05',
].join("\n");

/**
 * Runs the steps in a fork whose working branch has upstream's first commit. `setup` writes
 * GitHub's record of upstream's branch; `fake`, when given, stands in for the helper and
 * answers with those lines and that exit status.
 */
function run(steps, { setup, fake, shell = "bash" } = {}) {
  const repo = fork();
  const gh = github();
  // Where the first step, the fetch of the working branch, would leave it.
  repo.git("update-ref", "refs/remotes/origin/harden", "harden");
  mkdirSync(join(repo.dir, "scripts"));
  if (fake) {
    mkdirSync(join(repo.dir, "scripts", "harden"));
    const helper = join(repo.dir, "scripts", "harden", "upstream-eligible.sh");
    const lines = fake.lines.map((line) => `printf '%s\\n' '${line}'`);
    writeFileSync(helper, ["#!/bin/sh", ...lines, `exit ${fake.code}`, ""].join("\n"));
    chmodSync(helper, 0o755);
  } else {
    symlinkSync(HARDEN, join(repo.dir, "scripts", "harden"));
  }
  const facts = setup?.(repo, gh) ?? {};

  const bin = mkdtempSync(join(tmpdir(), "codeharden-readme-bin-"));
  const log = join(bin, "git-calls");
  writeFileSync(log, "");
  const realGit = sh(tmpdir(), "/bin/sh", ["-c", "command -v git"]).out;
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/sh",
      "# A fetch or a push is written down, each argument in brackets, and not run.",
      'case "$1" in fetch | push)',
      `  for arg in "$@"; do printf '[%s]' "$arg"; done >> "${log}"`,
      `  printf '\\n' >> "${log}"`,
      "  exit 0 ;;",
      "esac",
      `exec "${realGit}" "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "git"), 0o755);

  // The two names a reader fills in.
  expect(steps).toContain("<the repository you follow>");
  const script = join(bin, "steps.sh");
  writeFileSync(
    script,
    `${steps.replaceAll("<the repository you follow>", UPSTREAM).replaceAll("<you>/<your fork>", FORK)}\n`,
  );
  const result = sh(repo.dir, shell, [script], {
    ...gh.env,
    PATH: `${bin}:${gh.env.PATH}`,
    UPSTREAM_REPO: UPSTREAM,
    UPSTREAM_BRANCH: "trunk",
    FORK_CONFIG_NO_GH: "1",
    SYNC_COOLDOWN_NOW: NOW,
  });
  return {
    ...result,
    ...facts,
    git: readFileSync(log, "utf8").split("\n").filter(Boolean),
    pulls: gh.calls().filter((call) => call.startsWith("pr ")),
  };
}

/** GitHub's record of upstream's branch for each answer of the helper that is not a yes. */
const NOT_A_YES = {
  none: (repo, gh) => {
    const young = repo.upstreamCommit();
    gh.branch("trunk", [
      [at(24, "18:00"), young],
      [at(20), repo.git("rev-parse", "up^")],
    ]);
  },
  "up-to-date": (repo, gh) => {
    gh.branch("trunk", [[at(20), repo.git("rev-parse", "up"), "branch_creation"]]);
  },
  rewritten: (repo, gh) => {
    const old = repo.upstreamCommit();
    gh.branch("trunk", [
      [at(24, "20:00"), "f".repeat(40), "force_push"],
      [at(21), old],
      [at(20), repo.git("rev-parse", "up^")],
    ]);
  },
  unknown: (repo, gh) => {
    gh.branch("trunk", [[at(20), repo.upstreamCommit()]]);
    gh.fail("activity");
  },
};

describe("the README's steps for a sync by hand", () => {
  const steps = readmeSteps();

  it.each(Object.keys(NOT_A_YES))("fetch and push nothing when the helper answers %s", (state) => {
    expect(SHELLS).toEqual(expect.arrayContaining(["bash", "sh"]));
    for (const shell of SHELLS) {
      const result = run(steps, { setup: NOT_A_YES[state], shell });
      expect(result.git).toEqual([OWN]);
      expect(result.pulls).toEqual([]);
      // They say why instead: the helper's own sentence.
      expect(result.out).toMatch(
        /^(No upstream commit is out of quarantine; next eligible |No new upstream commits: |Upstream's history was rewritten inside the quarantine |The quarantine could not be evaluated; nothing is eligible\.)/,
      );
    }
  });

  it("take exactly the commit the helper named, by its full id, on a yes", () => {
    for (const shell of SHELLS) {
      const result = run(steps, {
        shell,
        setup: (repo, gh) => {
          const base = repo.git("rev-parse", "up");
          const eligible = repo.upstreamCommit("upstream-2.txt", "fix: upstream two");
          const young = repo.upstreamCommit("upstream-3.txt", "feat: upstream three");
          gh.branch("trunk", [
            [at(25, "08:00"), young],
            [at(22, "09:00"), eligible],
            [at(20), base],
          ]);
          return { eligible };
        },
      });
      expect(result.eligible).toMatch(/^[0-9a-f]{40}$/);
      expect(result.git).toEqual([
        OWN,
        `[fetch][--no-tags][https://github.com/${UPSTREAM}][${result.eligible}]`,
        `[push][origin][${result.eligible}:refs/heads/sync/2026-01-05]`,
      ]);
      expect(result.pulls).toEqual([
        `pr create --repo ${FORK} --base harden --head sync/2026-01-05 --title sync: upstream to 2026-01-05`,
      ]);
    }
  });

  // Each guard by itself, with a stand-in for the helper that breaks exactly one of them.
  const id = "a".repeat(40);
  it.each([
    ["an exit status that is not 0", { code: 1, lines: ["state: eligible", `commit: ${id}`] }],
    ["a state that is not eligible", { code: 0, lines: ["state: none", `commit: ${id}`] }],
    [
      "a state that only starts with eligible",
      { code: 0, lines: ["state: eligible-ish", `commit: ${id}`] },
    ],
    ["an empty commit", { code: 0, lines: ["state: eligible", "commit: "] }],
    ["no commit line", { code: 0, lines: ["state: eligible"] }],
    ["a short id", { code: 0, lines: ["state: eligible", "commit: aaaaaaaa"] }],
    ["a branch name for an id", { code: 0, lines: ["state: eligible", "commit: main"] }],
    [
      "an id with something after it",
      { code: 0, lines: ["state: eligible", `commit: ${id} main`] },
    ],
    ["an option for an id", { code: 0, lines: ["state: eligible", "commit: --upload-pack=x"] }],
    ["no output at all", { code: 0, lines: [] }],
  ])("fetch and push nothing on %s", (_name, fake) => {
    const result = run(steps, { fake });
    expect(result.git).toEqual([OWN]);
    expect(result.pulls).toEqual([]);
  });

  it("go through with a stand-in that breaks none of the guards, and stop without the helper", () => {
    const yes = run(steps, { fake: { code: 0, lines: ["state: eligible", `commit: ${id}`] } });
    expect(yes.git).toHaveLength(3);
    expect(yes.git[1]).toBe(`[fetch][--no-tags][https://github.com/${UPSTREAM}][${id}]`);
    // A fork that does not have the helper yet: the steps run nothing of it and take nothing.
    const missing = run(steps.replace("upstream-eligible.sh latest", "no-such-helper.sh latest"));
    expect(missing.git).toEqual([OWN]);
    expect(missing.pulls).toEqual([]);
  });

  it("would be caught if the helper were piped into the commit again", () => {
    const result = run(PIPED, { setup: NOT_A_YES.none });
    // The hole: upstream's HEAD is fetched, and the push asks for the branch to be deleted.
    expect(result.git).toEqual([
      OWN,
      `[fetch][--no-tags][https://github.com/${UPSTREAM}][]`,
      "[push][origin][:refs/heads/sync/2026-01-05]",
    ]);
  });

  it("show each guard, and no fetch or push outside them", () => {
    const lines = steps.split("\n");
    // The helper's output is kept and its exit status read; it is never piped away.
    expect(lines).toContain("answer=$(scripts/harden/upstream-eligible.sh latest); code=$?");
    expect(steps.match(/upstream-eligible\.sh[^\n]*\|/g)).toBeNull();
    const guard = lines.findIndex((line) => line.startsWith("if "));
    const otherwise = lines.indexOf("else");
    expect(lines[guard]).toBe(
      `if [ "$code" = 0 ] && [ "$state" = eligible ] && printf '%s\\n' "$commit" | grep -Eqx '[0-9a-f]{40}'; then`,
    );
    expect(otherwise).toBeGreaterThan(guard);
    expect(lines.at(-1)).toBe("fi");
    const takes = lines.flatMap((line, i) =>
      /\bgit (fetch|push)\b|\bgh pr\b/.test(line) ? [i] : [],
    );
    // The fork's own working branch first, then everything else behind the guard.
    expect(lines[takes[0]]).toBe("git fetch origin harden");
    expect(takes.slice(1)).toHaveLength(3);
    for (const i of takes.slice(1)) {
      expect(i).toBeGreaterThan(guard);
      expect(i).toBeLessThan(otherwise);
    }
  });
});
