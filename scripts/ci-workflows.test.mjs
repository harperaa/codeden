import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `curl` piped into another command, e.g. `curl -sf URL | grep -q x`: quoted strings are skipped,
 * and `||`, `&&` and `;` end the curl command first. A reader that stops early (`grep -q` after
 * its match, `head`) closes the pipe while curl may still be writing, so curl exits 23 and the
 * step fails under `-eo pipefail` although the check passed (#539). Write the response to a file
 * and read the file.
 */
const CURL_PIPED = /\bcurl\b(?:"[^"]*"|'[^']*'|[^"'|;&\n]|&(?!&))*\|(?!\|)/;

/** The lines of a workflow (continuations joined, comments dropped) where curl is piped. */
function curlPipes(text) {
  return text
    .replace(/\\\r?\n\s*/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#") && CURL_PIPED.test(line));
}

const WORKFLOWS = fileURLToPath(new URL("../.github/workflows/", import.meta.url));

describe("CI workflows", () => {
  it.each([
    'curl -sf -H "cookie: a=$T" http://127.0.0.1:4791/ | grep -q "<title>CodeDen"',
    'curl -sf "http://x/?a=1&b=2" | head -n1',
    "X=$(curl -s http://x | jq .ok)",
    "curl -s http://x 2>&1 | tee out.txt",
    "curl -s http://x \\\n  -H 'a: b' | grep -q ok",
  ])("finds curl piped into a reader: %s", (line) => {
    expect(curlPipes(line)).toHaveLength(1);
  });

  it.each([
    "curl -sf http://127.0.0.1:4791/ > index.html",
    "curl -sf http://127.0.0.1:4791/api/health > health.json && break",
    "curl -sf http://x || true",
    'curl -sf "http://x/?a=1&b=2" > a.json; grep -q ok a.json | cat',
    "grep -q ok doctor.txt | head -n1",
    "# curl -sf http://x | grep -q ok",
  ])("leaves other commands alone: %s", (line) => {
    expect(curlPipes(line)).toEqual([]);
  });

  it("never pipe curl's output into another command", () => {
    const found = readdirSync(WORKFLOWS)
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) =>
        curlPipes(readFileSync(join(WORKFLOWS, name), "utf8")).map((line) => `${name}: ${line}`),
      );
    expect(found, "write the response to a file and grep the file").toEqual([]);
  });
});

const CI = readFileSync(join(WORKFLOWS, "ci.yml"), "utf8");
/** The text of a `${{ ... }}` expression that follows `key` in ci.yml. */
function expression(key) {
  const found = new RegExp(`^ *${key}: \\$\\{\\{ (.+) \\}\\}$`, "m").exec(CI);
  if (!found) throw new Error(`ci.yml has no "${key}: \${{ ... }}"`);
  return found[1];
}
/** The test step: its `if` is the line after its `id`. */
const TESTS_IF = /- run: pnpm test\n +id: tests\n +if: \$\{\{ (.+) \}\}\n/.exec(CI)?.[1] ?? "";

/**
 * A workflow expression made of `==`, `&&`, `||`, `!` and quoted strings reads the same in
 * JavaScript, so it is evaluated as written against a `github` and `vars` context.
 */
function evaluate(text, { github, vars = {} }) {
  return Boolean(new Function("github", "vars", `return (${text});`)(github, vars));
}
const pullRequest = (base, draft = false, head = "codeden/some-work") => ({
  event_name: "pull_request",
  base_ref: base,
  head_ref: head,
  event: { pull_request: { draft } },
});
const push = (branch) => ({
  event_name: "push",
  ref: `refs/heads/${branch}`,
  base_ref: "",
  event: {},
});

describe("when CI runs the tests", () => {
  it.each([
    ["a pull request into harden", { github: pullRequest("harden") }, true],
    [
      "a sync pull request into harden",
      { github: pullRequest("harden", false, "sync/2026-11-23") },
      true,
    ],
    ["a draft pull request into harden", { github: pullRequest("harden", true) }, false],
    ["a pull request into another branch", { github: pullRequest("main") }, false],
    ["a push to harden", { github: push("harden") }, false],
    ["a push to main", { github: push("main") }, false],
    ["a run started by hand", { github: { event_name: "workflow_dispatch", event: {} } }, false],
    [
      "a pull request into a fork's own working branch",
      { github: pullRequest("work"), vars: { HARDEN_BRANCH: "work" } },
      true,
    ],
    [
      "a pull request into harden where the working branch has another name",
      { github: pullRequest("harden"), vars: { HARDEN_BRANCH: "work" } },
      false,
    ],
  ])("%s", (_name, context, expected) => {
    expect(TESTS_IF).not.toBe("");
    expect(evaluate(TESTS_IF, context)).toBe(expected);
  });

  it("the result job expects the tests exactly when the test step runs", () => {
    expect(expression("TESTS_EXPECTED")).toBe(TESTS_IF);
    expect(expression("tests")).toBe("steps.tests.outcome");
    expect(expression("TESTS")).toBe("needs.check.outputs.tests");
  });

  it("a draft marked ready for review starts a run, and no switch turns the tests off", () => {
    const types = /^ {2}pull_request:\n(?: +#.*\n)* +types: \[(.+)\]$/m.exec(CI)?.[1].split(", ");
    expect(types).toEqual(["opened", "synchronize", "reopened", "ready_for_review"]);
    expect(CI).not.toContain("CI_TESTS");
    expect(CI.match(/pnpm test$/gm)).toHaveLength(1);
  });

  it("a newer push to a pull request cancels its older run", () => {
    expect(/^ {2}group: ci-\$\{\{ (.+) \}\}$/m.exec(CI)?.[1]).toBe(
      "github.event_name == 'pull_request' && github.ref || github.run_id",
    );
    expect(expression("cancel-in-progress")).toBe("github.event_name == 'pull_request'");
  });
});

describe("the CI result job", () => {
  const script = (/name: The check passed[\s\S]*?\n {8}run: \|\n([\s\S]*)$/.exec(CI)?.[1] ?? "")
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
  const result = (env) =>
    spawnSync("bash", ["-eo", "pipefail", "-c", script], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, CHANGES: "success", CODE: "true", ...env },
    });

  it.each([
    ["the tests ran and passed", { CHECK: "success", TESTS: "success", TESTS_EXPECTED: "true" }, 0],
    [
      "a draft: the checks passed, the tests were not expected",
      { CHECK: "success", TESTS: "skipped", TESTS_EXPECTED: "false" },
      0,
    ],
    [
      "a push: the checks passed, the tests were not expected",
      { CHECK: "success", TESTS: "skipped", TESTS_EXPECTED: "false" },
      0,
    ],
    [
      "documentation only: the check was skipped",
      { CODE: "false", CHECK: "skipped", TESTS: "", TESTS_EXPECTED: "true" },
      0,
    ],
    [
      "the tests were expected but skipped",
      { CHECK: "success", TESTS: "skipped", TESTS_EXPECTED: "true" },
      1,
    ],
    [
      "the tests were expected but nothing reported them",
      { CHECK: "success", TESTS: "", TESTS_EXPECTED: "true" },
      1,
    ],
    ["the tests failed", { CHECK: "failure", TESTS: "failure", TESTS_EXPECTED: "true" }, 1],
    ["the check was cancelled", { CHECK: "cancelled", TESTS: "", TESTS_EXPECTED: "true" }, 1],
    [
      "the check was skipped although code changed",
      { CHECK: "skipped", TESTS: "", TESTS_EXPECTED: "true" },
      1,
    ],
    [
      "change detection failed",
      { CHANGES: "failure", CODE: "", CHECK: "skipped", TESTS: "", TESTS_EXPECTED: "true" },
      1,
    ],
  ])("%s", (_name, env, status) => {
    expect(script).toContain("TESTS_EXPECTED");
    expect(result(env).status).toBe(status);
  });

  it("always runs, so a pull request never waits for a result", () => {
    expect(CI).toMatch(
      /\n {2}result:\n {4}name: CI result\n {4}needs: \[changes, check\]\n {4}if: always\(\)\n/,
    );
  });
});
