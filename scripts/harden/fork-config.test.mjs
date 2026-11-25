// The fork's configuration, as the shell scripts and the sync workflow resolve it: the same
// defaults, the same refusals. The workflow's rules are cut out of the workflow file and run
// with bash, beside scripts/harden/fork-config.sh.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { repository, sh, stubTools } from "./test-support/scratch.mjs";

const CONFIG = fileURLToPath(new URL("./fork-config.sh", import.meta.url));
const RELEASE = fileURLToPath(new URL("./release.sh", import.meta.url));
const PUBLISH = fileURLToPath(new URL("./publish.sh", import.meta.url));
const workflow = readFileSync(
  new URL("../../.github/workflows/upstream-sync-merge.yml", import.meta.url),
  "utf8",
);
const workflowRules = /# fork-config:begin\n([\s\S]*?)# fork-config:end/.exec(workflow)?.[1] ?? "";
const NAMES = [
  "UPSTREAM_REPO",
  "UPSTREAM_BRANCH",
  "PACKAGE_NAME",
  "HARDEN_BRANCH",
  "MIRROR_BRANCH",
];
const FORK_URL = "https://github.com/example/example-harden.git";

/** What fork-config.sh resolves in a checkout with this origin, as `{ code, values, err }`. */
function resolve({ origin, env = {}, tools = stubTools(), names = NAMES } = {}) {
  const repo = repository("codeharden-config-test-");
  if (origin) repo.git("remote", "add", "origin", origin);
  const script = `. "$1"; shift; fork_config_resolve "$@"; for n in "$@"; do printf '%s=%s\\n' "$n" "\${!n}"; done; printf 'FORK_REPO=%s\\n' "$FORK_REPO"`;
  const result = sh(repo.dir, "bash", ["-c", script, "bash", CONFIG, ...names], {
    ...tools.env,
    ...env,
  });
  const values = Object.fromEntries(result.out.split("\n").map((line) => line.split("=")));
  return { code: result.code, values, err: result.err, tools };
}

/** What the workflow's config job makes of the repository variables. */
function workflowConfig(repo, vars = {}) {
  const env = { GITHUB_REPOSITORY: repo };
  for (const name of NAMES) env[`VAR_${name}`] = vars[name] ?? "";
  const print =
    'printf "UPSTREAM_REPO=%s\\nUPSTREAM_BRANCH=%s\\nPACKAGE_NAME=%s\\nHARDEN_BRANCH=%s\\nMIRROR_BRANCH=%s\\n" "$upstream_repo" "$upstream_branch" "$package_name" "$target_branch" "$mirror_branch"';
  const result = sh(
    process.cwd(),
    "bash",
    ["-c", `set -euo pipefail\n${workflowRules}\n${print}`],
    env,
  );
  const values = Object.fromEntries(
    result.out
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => line.split("=")),
  );
  return { code: result.code, values, out: result.out };
}

const CODEHARDEN = {
  UPSTREAM_REPO: "leonvanzyl/codeden",
  UPSTREAM_BRANCH: "main",
  PACKAGE_NAME: "codeharden",
  HARDEN_BRANCH: "harden",
  MIRROR_BRANCH: "main",
};
const FORK_VARS = {
  UPSTREAM_REPO: "harperaa/codeharden",
  UPSTREAM_BRANCH: "harden",
  PACKAGE_NAME: "example-harden",
};
const FORK = { ...FORK_VARS, HARDEN_BRANCH: "harden", MIRROR_BRANCH: "mirror" };

describe("the fork's configuration", () => {
  it("is CodeHarden's own in CodeHarden, with nothing set and without asking GitHub", () => {
    for (const origin of [
      "https://github.com/harperaa/codeharden",
      "git@github.com:harperaa/codeharden.git",
      undefined,
      "/somewhere/else.git",
    ]) {
      const result = resolve({ origin });
      expect(result.err).toBe("");
      expect(result.values).toMatchObject(CODEHARDEN);
      expect(result.tools.ghCalls()).toEqual([]);
    }
    expect(workflowConfig("harperaa/codeharden").values).toEqual(CODEHARDEN);
  });

  it("is the fork's own from its repository variables, with the mirror branch derived", () => {
    const result = resolve({ origin: FORK_URL, tools: stubTools({ vars: FORK_VARS }) });
    expect(result.err).toBe("");
    expect(result.values).toEqual({ ...FORK, FORK_REPO: "example/example-harden" });
    expect(workflowConfig("example/example-harden", FORK_VARS).values).toEqual(FORK);
  });

  it("lets the environment win, and HARDEN_BRANCH and MIRROR_BRANCH name other branches", () => {
    const vars = { ...FORK_VARS, HARDEN_BRANCH: "work", MIRROR_BRANCH: "upstream-copy" };
    const result = resolve({ origin: FORK_URL, env: { ...vars, FORK_CONFIG_NO_GH: "1" } });
    expect(result.values).toMatchObject(vars);
    expect(result.tools.ghCalls()).toEqual([]);
    expect(workflowConfig("example/example-harden", vars).values).toEqual(vars);
    // A working branch with another name frees the upstream branch's name for the mirror.
    const renamed = { ...FORK_VARS, HARDEN_BRANCH: "work" };
    expect(workflowConfig("example/example-harden", renamed).values.MIRROR_BRANCH).toBe("harden");
    expect(
      resolve({ origin: FORK_URL, env: { ...renamed, FORK_CONFIG_NO_GH: "1" } }).values
        .MIRROR_BRANCH,
    ).toBe("harden");
  });

  it("has no default for the three variables outside CodeHarden", () => {
    const result = resolve({ origin: FORK_URL });
    expect(result.code).toBe(1);
    expect(result.err).toContain("UPSTREAM_REPO is not set");
    expect(result.err).toContain("example/example-harden, not harperaa/codeharden");
    const inWorkflow = workflowConfig("example/example-harden");
    expect(inWorkflow.code).toBe(1);
    for (const name of ["UPSTREAM_REPO", "UPSTREAM_BRANCH", "PACKAGE_NAME"]) {
      expect(inWorkflow.out).toContain(`::error::The repository variable ${name} is not set`);
    }
    // One missing is enough.
    const partial = { UPSTREAM_REPO: "harperaa/codeharden", UPSTREAM_BRANCH: "harden" };
    expect(workflowConfig("example/example-harden", partial).code).toBe(1);
    expect(resolve({ origin: FORK_URL, tools: stubTools({ vars: partial }) }).err).toContain(
      "PACKAGE_NAME is not set",
    );
  });

  it("refuses malformed values, in the scripts and in the workflow alike", () => {
    const bad = [
      ["UPSTREAM_REPO", "https://github.com/a/b"],
      ["UPSTREAM_REPO", "a/b/c"],
      ["UPSTREAM_REPO", "a/.."],
      ["UPSTREAM_REPO", "a b/c"],
      ["UPSTREAM_BRANCH", "main; rm -rf x"],
      ["UPSTREAM_BRANCH", "$(id)"],
      ["UPSTREAM_BRANCH", "a..b"],
      ["UPSTREAM_BRANCH", "-delete"],
      ["HARDEN_BRANCH", "refs/heads/x.lock"],
      ["MIRROR_BRANCH", "two words"],
      ["PACKAGE_NAME", "Example"],
      ["PACKAGE_NAME", "../x"],
      ["PACKAGE_NAME", "x --tag latest"],
    ];
    for (const [name, value] of bad) {
      const vars = { ...FORK_VARS, [name]: value };
      const local = resolve({ origin: FORK_URL, env: { ...vars, FORK_CONFIG_NO_GH: "1" } });
      expect(local.code, `${name}=${value}`).toBe(1);
      expect(local.err).toContain(`${name} must be`);
      const inWorkflow = workflowConfig("example/example-harden", vars);
      expect(inWorkflow.code, `${name}=${value}`).toBe(1);
      expect(inWorkflow.out).toContain(`::error::The repository variable ${name} must be`);
      // The workflow names the variable, never the value.
      expect(inWorkflow.out).not.toContain(value);
    }
    const same = { ...FORK_VARS, MIRROR_BRANCH: "harden" };
    expect(workflowConfig("example/example-harden", same).out).toContain("they must differ");
    const self = { ...FORK_VARS, UPSTREAM_REPO: "Example/example-harden" };
    expect(workflowConfig("example/example-harden", self).out).toContain("this repository itself");
  });

  it("keeps the workflow's safety properties", () => {
    // Repository variables and job outputs reach scripts through env only.
    const scripts = workflow.split(/\n\s+run: \|\n/).slice(1);
    expect(scripts.length).toBeGreaterThan(3);
    for (const script of scripts) {
      const body = script.split(/\n {2}\S|\n {6}- name:/)[0];
      expect(body).not.toContain("${{");
    }
    expect(workflow).not.toMatch(/^\s+(?:- )?uses:/m);
    expect(workflow).not.toMatch(/push[^\n]*(--force|\s-f\s)/);
    for (const job of ["mirror", "merge"]) {
      expect(workflow).toMatch(
        new RegExp(`\\n  ${job}:\\n    name: [^\\n]+\\n    needs: config\\n`),
      );
    }
    expect(workflow).toContain("needs.config.result == 'success'");
    expect(workflow).toMatch(/^ {2}PROTECTED_PATHS: scripts\/harden\/(?: \S+)*$/m);
  });
});

/** A checkout on its release tag, as publish.sh wants it. */
function released(origin) {
  const repo = repository("codeharden-config-test-");
  repo.commit("upstream-1.txt", "feat: upstream one");
  repo.git("branch", "up");
  mkdirSync(join(repo.dir, "state"));
  writeFileSync(join(repo.dir, "VERSION"), "2026.1122.2006\n");
  writeFileSync(join(repo.dir, "state", "upstream-base"), `${repo.git("rev-parse", "HEAD")}\n`);
  writeFileSync(join(repo.dir, "CODEHARDEN-CHANGELOG.md"), "# CodeHarden releases\n\n");
  repo.git("add", ".");
  repo.git("commit", "--quiet", "-m", "release: 2026.1122.2006 (upstream 00000000)");
  repo.git("tag", "-a", "v2026.1122.2006", "-m", "CodeHarden 2026.1122.2006");
  if (origin) repo.git("remote", "add", "origin", origin);
  return repo;
}

describe("a fork's releases", () => {
  it("publish.sh refuses to publish as codeharden from another repository", () => {
    for (const origin of [FORK_URL, undefined]) {
      const repo = released(origin);
      const tools = stubTools();
      const result = sh(repo.dir, "bash", [PUBLISH, "--dry-run"], tools.env);
      expect(result.code).toBe(1);
      expect(result.err).toContain("publish: PACKAGE_NAME is not set");
      expect(result.err).toContain("not harperaa/codeharden");
      expect(result.out).toBe("");
    }
  });

  it("release.sh refuses a fork with no upstream set, and names the fork's own in the entry", () => {
    const repo = released(FORK_URL);
    repo.commit("own.txt", "feat: the fork's own change");
    repo.git("checkout", "--quiet", "up");
    repo.commit("upstream-2.txt", "fix: upstream two");
    repo.git("checkout", "--quiet", "harden");
    repo.git("merge", "--quiet", "--no-ff", "up", "-m", "Merge upstream");
    // Stand-ins for the fork on GitHub (its release tags) and for the upstream it follows
    // (whose branch is `harden`): the release reads both, and nothing reaches the network.
    const bare = (name) => {
      const dir = mkdtempSync(join(tmpdir(), `codeharden-config-${name}-`));
      sh(dir, "git", ["init", "--quiet", "--bare"]);
      return dir;
    };
    const origin = bare("origin");
    const upstream = bare("upstream");
    repo.git("push", "--quiet", origin, "harden", "v2026.1122.2006");
    repo.git("push", "--quiet", upstream, "up:refs/heads/harden");
    const run = (tools) =>
      sh(repo.dir, "bash", [RELEASE, "--upstream-ref", "up", "--dry-run"], {
        RELEASE_NOW: "2026.1123.0905 2026-11-23 09:05",
        GIT_STUB_REMOTES: `origin=${origin} https://github.com/harperaa/codeharden=${upstream}`,
        ...tools.env,
      });
    const unset = run(stubTools());
    expect(unset.code).toBe(1);
    expect(unset.err).toContain("release: UPSTREAM_REPO is not set");

    const tools = stubTools({ vars: FORK_VARS });
    const set = run(tools);
    expect(set.err).toBe("");
    expect(set.out).toContain("### upstream (harperaa/codeharden)\n- fix: upstream two");
    expect(set.out).toContain("### example-harden\n- feat: the fork's own change");
    // It asks the fork's own repository what was merged, and its upstream where its branch is.
    expect(
      tools.ghCalls().some((call) => call.includes("repos/example/example-harden/pulls")),
    ).toBe(true);
    expect(tools.gitCalls()).toContain(
      "ls-remote https://github.com/harperaa/codeharden refs/heads/harden",
    );
    expect(set.out).toContain("which is not the merge of a pull request into harden");
  });
});
