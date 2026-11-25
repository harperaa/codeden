// The desktop installers workflow's safety rules, read from the file as written: it only runs
// when a person starts it, only one job may write, no input reaches a script except through
// the environment, it uses the actions upstream's workflows already use, a real run signs and
// publishes only behind the `release` environment's approval, and a dry run names no
// environment and is given no secret.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (name) =>
  readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8");
const workflow = read("harden-desktop.yml");
const sync = read("upstream-sync-merge.yml");

/** The text of each top-level job, by name. */
function jobs(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  const out = {};
  let name = null;
  for (const line of body.split("\n")) {
    const start = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(line);
    if (start) {
      name = start[1];
      out[name] = "";
    } else if (name) out[name] += `${line}\n`;
  }
  return out;
}

/** The lines of every `run:` block (and one-line `run:`), without YAML comments' help. */
function scripts(text) {
  const lines = text.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[2] && m[2] !== "|") {
      found.push(m[2]);
      continue;
    }
    const indent = m[1].length;
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() !== "" && line.search(/\S/) <= indent) {
        i--;
        break;
      }
      found.push(line);
    }
  }
  return found.join("\n");
}

const MAC = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];
const WIN = ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"];
/** A secret read in an expression (`secrets.NAME`), as opposed to the word in a sentence. */
const SECRET = /\bsecrets\.[A-Za-z_]/;

/** Every `NAME: ${{ … }}` line of `text` whose expression names a secret, as [name, expression]. */
function secretExpressions(text) {
  return [...text.matchAll(/^\s+([A-Z_]+): \$\{\{ (.*secrets\.[A-Z_]+.*) \}\}$/gm)].map(
    ([, name, expression]) => [name, expression],
  );
}

/**
 * The value of a workflow expression for one run. The expressions here use only `!`, `&&`,
 * `||`, `==`, `!=`, brackets, quoted strings, numbers and `fromJSON`, which mean the same in
 * JavaScript for the values they are given (booleans and non-numeric strings).
 */
function evaluate(expression, { dryRun, os = "", secrets = {} }) {
  const source = expression
    .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
    .replace(/\binputs\.dry-run\b/g, "inputs.dryRun")
    .replace(/\bsecrets\.([A-Z_]+)/g, "(secrets.$1 ?? '')");
  expect(source).toMatch(/^[\w\s.'"!&|=?()[\],-]+$/);
  return new Function("inputs", "matrix", "secrets", "fromJSON", `return (${source});`)(
    { dryRun },
    { os },
    secrets,
    JSON.parse,
  );
}

/** The lines under a job's `    key:`, as written (comments included), up to the job's next key. */
function jobBlock(job, key) {
  const lines = job.split("\n");
  const start = lines.indexOf(`    ${key}:`);
  expect(start).toBeGreaterThan(-1);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && line.search(/\S/) < 6) break;
    body.push(line);
  }
  while (body.at(-1)?.trim() === "") body.pop();
  return body.join("\n");
}

/** A job's permissions, as `name: level` in the order written. */
function permissions(job) {
  return jobBlock(job, "permissions")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** The value of a top-level key of a job (`    key: value`), as written. */
function jobKey(job, key) {
  return new RegExp(`^ {4}${key}: (.+)$`, "m").exec(job)?.[1];
}

const TAG_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const ALL_SET = Object.fromEntries([...MAC, ...WIN].map((n) => [n, `value-of-${n}`]));
const SYSTEMS = ["windows-latest", "macos-latest", "ubuntu-latest"];

describe("the desktop installers workflow", () => {
  it("starts only when a person runs it, dry by default", () => {
    const on = workflow.slice(workflow.indexOf("\non:\n"), workflow.indexOf("\npermissions:"));
    expect(on).toContain("workflow_dispatch:");
    expect(on).not.toMatch(
      /^\s+(push|pull_request|pull_request_target|schedule|release|workflow_run):/m,
    );
    expect(on).toMatch(/dry-run:[\s\S]*?type: boolean[\s\S]*?default: true/);
  });

  it("grants nothing by default, and write access to the release job alone", () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    expect(workflow).not.toContain("id-token");
    const all = jobs(workflow);
    expect(Object.keys(all)).toEqual(["check", "build", "sign", "release"]);
    // The check job also reads the environment's rules, which is the Actions permission.
    expect(permissions(all.check)).toEqual(["contents: read", "actions: read"]);
    expect(permissions(all.build)).toEqual(["contents: read"]);
    expect(permissions(all.sign)).toEqual(["contents: read"]);
    expect(permissions(all.release)).toEqual(["contents: write", "actions: read"]);
    expect(all.build).toMatch(/permissions:\n\s+contents: read\n/);
    expect(all.sign).toMatch(/permissions:\n\s+contents: read\n/);
    expect(all.check + all.build + all.sign).not.toMatch(/: write\b/);
    expect(all.release).toMatch(/permissions:\n\s+contents: write\n\s+actions: read\n/);
  });

  it("publishes only after every build, and only when dry-run is off", () => {
    const { release, build, sign } = jobs(workflow);
    expect(release).toContain("needs: [check, build, sign]");
    expect(release).toMatch(/^ {4}if: \$\{\{ !inputs\.dry-run \}\}$/m);
    // The build jobs never upload to a release themselves.
    expect(build + sign).not.toContain("gh release");
    expect(build + sign).not.toMatch(/--publish (?!never)/);
    // Draft first, the update files after the installers, published last.
    const order = [
      "--draft",
      'others[@]}" --repo',
      'feeds[@]}" --repo',
      "--draft=false --latest",
    ].map((s) => release.indexOf(s));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The release job runs no code from the repository.
    expect(release).not.toContain("actions/checkout");
    expect(release).not.toMatch(/pnpm|node /);
  });

  it("passes inputs and other expressions to scripts through the environment only", () => {
    expect(scripts(workflow)).not.toContain("${{");
    expect(workflow).toMatch(/TAG: \$\{\{ inputs\.tag \}\}/);
    expect(scripts(workflow)).toContain(
      '[[ ! "$TAG" =~ ^v([0-9]{4})\\.([0-9]{4})\\.([0-9]{4})$ ]]',
    );
  });

  it("uses only the actions, at the versions, that upstream's workflows use", () => {
    const uses = (text) => [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    const known = new Set([...uses(read("release.yml")), ...uses(read("ci.yml"))]);
    for (const action of uses(workflow)) expect(known).toContain(action);
  });

  it("gives each system its own signing secrets and no other system's", () => {
    const { build, check, sign, release } = jobs(workflow);
    const mac = MAC;
    const win = WIN;
    const given = secretExpressions(build).filter(([name]) => name !== "HAS_SIGNING_SECRETS");
    // Every secret is behind its system's condition, and behind "not a dry run"; none is
    // passed to all three systems.
    expect(given.map(([name]) => name).sort()).toEqual([...mac, ...win].sort());
    for (const [name, expression] of given) {
      const os = mac.includes(name) ? "macos-latest" : "windows-latest";
      expect(expression).toBe(`!inputs.dry-run && matrix.os == '${os}' && secrets.${name} || ''`);
    }
    // The one other place: the step that asks only whether a secret is set, once per name.
    const [, asked] = secretExpressions(build).find(([name]) => name === "HAS_SIGNING_SECRETS");
    expect([...asked.matchAll(/secrets\.([A-Z_]+) != ''/g)].map((m) => m[1]).sort()).toEqual(
      [...mac, ...win].sort(),
    );
    // The build job names none anywhere else, `sign` has the same steps (so the same
    // expressions), and no other job names a secret.
    expect(build.match(new RegExp(SECRET, "g"))).toHaveLength(2 * (mac.length + win.length));
    expect(secretExpressions(sign)).toEqual(secretExpressions(build));
    expect(sign.match(new RegExp(SECRET, "g"))).toHaveLength(2 * (mac.length + win.length));
    expect(check + release).not.toMatch(SECRET);
    // And the script drops the other systems' variables again before anything is built.
    const script = scripts(workflow);
    const drop = script.indexOf('if [ "$RUNNER_OS" != "macOS" ]; then unset');
    expect(drop).toBeGreaterThan(-1);
    expect(script).toContain('if [ "$RUNNER_OS" != "Windows" ]; then unset');
    expect(drop).toBeLessThan(script.indexOf("pnpm --filter @codeden/desktop package"));
  });

  it("stops on half-configured signing and checks a signed macOS app strictly", () => {
    const script = scripts(workflow);
    const stop = script.indexOf("macOS signing is half configured");
    expect(stop).toBeGreaterThan(-1);
    expect(script).toContain("Windows signing is half configured");
    expect(stop).toBeLessThan(script.indexOf("pnpm --filter @codeden/desktop package"));
    // The message names the missing secrets; it never prints a value.
    expect(script).not.toMatch(
      /echo[^\n]*\$\{?(CSC_LINK|CSC_KEY_PASSWORD|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID|WIN_CSC_LINK|WIN_CSC_KEY_PASSWORD)\b/,
    );
    expect(script).toContain('echo "REQUIRE_DEVELOPER_ID=1" >> "$GITHUB_ENV"');
    const check = readFileSync(
      new URL("../../apps/desktop/scripts/check-mac-signature.sh", import.meta.url),
      "utf8",
    );
    expect(check).toMatch(/^require_id="\$\{REQUIRE_DEVELOPER_ID:-\}"$/m);
    expect(check).toContain("xcrun stapler validate");
    expect(check).toContain("the app is not signed with a Developer ID");
    expect(check).toContain("Gatekeeper does not accept the downloaded app");
  });

  it("builds only the commit the check job examined, without keeping the job's credentials", () => {
    const { build } = jobs(workflow);
    expect(build).toContain("persist-credentials: false");
    expect(build).toMatch(
      /uses: actions\/checkout@\S+\n\s+with:\n\s+ref: refs\/tags\/\$\{\{ needs\.check\.outputs\.tag \}\}\n/,
    );
    expect(build.match(/actions\/checkout/g)).toHaveLength(1);
    // The tag is compared with the commit that was checked before anything from it runs: the
    // comparison is the step right after the checkout, and the first `uses:` or `pnpm` after.
    const steps = [...build.matchAll(/^ {6}- (?:name: (.+)|uses: (\S+)|run: (.+))$/gm)].map(
      (m) => m[1] ?? m[2] ?? m[3],
    );
    const checkout = steps.findIndex((step) => step.startsWith("actions/checkout@"));
    expect(steps[checkout + 1]).toBe("Check that the tag still names the commit that was checked");
    expect(steps.slice(0, checkout)).toEqual([
      "Check that the environment has the signing secrets",
    ]);
    expect(build).toMatch(/CHECKED: \$\{\{ needs\.check\.outputs\.sha \}\}\n/);
    const same = runStep(
      "Check that the tag still names the commit that was checked",
      { CHECKED: TAG_SHA },
      { FIXTURE_CHECKED_OUT: TAG_SHA },
    );
    expect(same.status).toBe(0);
    const moved = runStep(
      "Check that the tag still names the commit that was checked",
      { CHECKED: TAG_SHA },
      { FIXTURE_CHECKED_OUT: HEAD_SHA },
    );
    expect(moved.status).toBe(1);
    expect(moved.log).toContain("::error::The tag was moved after it was checked");
  });

  it("restores and saves no cache: a signed app is not built from an earlier run's files", () => {
    expect(workflow).not.toMatch(/uses: actions\/cache/);
    expect(workflow).not.toMatch(/^\s+cache: /m);
    expect(workflow).not.toContain("restore-keys");
    // setup-node caches by itself for some package managers unless told not to.
    const { build, sign } = jobs(workflow);
    for (const job of [build, sign]) {
      expect(job).toMatch(
        /uses: actions\/setup-node@\S+\n\s+with:\n\s+node-version: 24\n\s+package-manager-cache: false\n/,
      );
      expect(job).toMatch(/uses: pnpm\/action-setup@\S+\n {6}- uses: actions\/setup-node/);
    }
  });

  it("is a protected path of the sync workflow, with what it runs to package the app", () => {
    const paths = /^ {2}PROTECTED_PATHS: (.+)$/m.exec(sync)?.[1].split(" ") ?? [];
    expect(paths).toEqual(
      expect.arrayContaining([
        "scripts/harden/",
        ".github/workflows/harden-desktop.yml",
        "apps/desktop/scripts/",
        "apps/desktop/electron-builder.config.mjs",
      ]),
    );
  });
});

describe("approval before signing and publishing", () => {
  const all = jobs(workflow);

  it("puts a real run's signing jobs in the release environment, and only them", () => {
    const { check, build, sign, release } = all;
    expect(jobKey(sign, "environment")).toBe("release");
    // One environment in the whole file: one name to approve, and nothing else to set up.
    expect(workflow.match(/^\s*environment:/gm)).toHaveLength(1);
    expect(check + build + release).not.toMatch(/^\s*environment:/m);
    // The jobs that wait are exactly the systems that have signing secrets.
    expect(sign).toMatch(/matrix:\n\s+os: \[windows-latest, macos-latest\]\n/);
  });

  it("builds the signed installers with the very steps a dry run rehearsed", () => {
    const { build, sign } = all;
    // `sign` is `build` written out again (no YAML anchors: GitHub documents them for an `env`
    // map and a whole job, not for a list of steps). Line for line the same, comments too, so
    // a change to one that misses the other fails here.
    expect(jobBlock(build, "steps").split("\n").length).toBeGreaterThan(100);
    expect(jobBlock(sign, "steps")).toBe(jobBlock(build, "steps"));
    expect(jobBlock(sign, "env")).toBe(jobBlock(build, "env"));
    expect(workflow).not.toMatch(/^\s*[\w-]+: [&*][\w-]+\s*$/m);
    expect(workflow).not.toContain("<<:");
  });

  it("gives a secret to a real run's signing jobs only", () => {
    const { build } = all;
    const matrix = /^ {8}os: (\$\{\{ .+ \}\})$/m.exec(build)[1];
    // A real run: the job without an environment builds Linux alone, and Linux is given
    // nothing; the systems that are given secrets are the two in `sign`.
    expect(evaluate(matrix, { dryRun: false })).toEqual(["ubuntu-latest"]);
    for (const [name, expression] of secretExpressions(build)) {
      expect(evaluate(expression, { dryRun: false, os: "ubuntu-latest", secrets: ALL_SET })).toBe(
        name === "HAS_SIGNING_SECRETS" ? false : "",
      );
    }
    const given = (os) =>
      secretExpressions(build)
        .filter(([name]) => name !== "HAS_SIGNING_SECRETS")
        .filter(([, e]) => evaluate(e, { dryRun: false, os, secrets: ALL_SET }) !== "")
        .map(([name]) => name);
    expect(given("macos-latest")).toEqual(MAC);
    expect(given("windows-latest")).toEqual(WIN);
  });

  it("names no environment on a dry run, asks nobody and gives it no secret", () => {
    const { build, sign, release } = all;
    // The only jobs with an environment, and the publishing job, do not run.
    expect(evaluate(jobKey(sign, "if"), { dryRun: true })).toBe(false);
    expect(evaluate(jobKey(release, "if"), { dryRun: true })).toBe(false);
    // The job that does run builds all three systems and has no environment and no `if`.
    const matrix = /^ {8}os: (\$\{\{ .+ \}\})$/m.exec(build)[1];
    expect(evaluate(matrix, { dryRun: true })).toEqual(SYSTEMS);
    expect(jobKey(build, "environment")).toBeUndefined();
    expect(jobKey(build, "if")).toBeUndefined();
    // Every secret expression is empty on every system, also while a repository-level copy
    // of each secret still exists (which is what a job without an environment would read).
    const expressions = secretExpressions(build);
    expect(expressions).toHaveLength(MAC.length + WIN.length + 1);
    for (const os of SYSTEMS) {
      for (const [name, expression] of expressions) {
        if (name === "HAS_SIGNING_SECRETS") continue;
        expect(evaluate(expression, { dryRun: true, os, secrets: ALL_SET })).toBe("");
      }
      // The step that asks whether secrets are set is skipped altogether.
      const asks = /- name: Check that the environment has the signing secrets\n\s+if: (.+)\n/.exec(
        build,
      )[1];
      expect(evaluate(asks, { dryRun: true, os })).toBe(false);
      expect(evaluate(asks, { dryRun: false, os })).toBe(os !== "ubuntu-latest");
    }
  });

  it("cannot publish on a dry run, nor before the signing jobs were approved and passed", () => {
    const { sign, release } = all;
    // Its own condition, and the jobs it waits for: `sign` is skipped on a dry run, and a
    // job is skipped when one it needs was skipped, was rejected or failed (no `always()`).
    expect(evaluate(jobKey(release, "if"), { dryRun: true })).toBe(false);
    expect(evaluate(jobKey(release, "if"), { dryRun: false })).toBe(true);
    expect(jobKey(release, "needs")).toBe("[check, build, sign]");
    expect(jobKey(sign, "if")).toMatch(/^\$\{\{ !inputs\.dry-run \}\}$/);
    expect(release).not.toMatch(/always\(\)|cancelled\(\)|failure\(\)/);
    // It names no environment on purpose: a second job in the environment, an hour after
    // the first two, would ask for a second approval.
    expect(jobKey(release, "environment")).toBeUndefined();
    // Nothing is written before the tag is known to still name the commit that was built.
    expect(
      release.indexOf("Check that the tag still names the commit that was built"),
    ).toBeLessThan(release.indexOf("gh release create"));
  });

  it("gives the signed macOS build two hours, for Apple's notarization", () => {
    const timeout = jobKey(all.sign, "timeout-minutes");
    expect(evaluate(timeout, { dryRun: false, os: "macos-latest" })).toBe(120);
    expect(evaluate(timeout, { dryRun: false, os: "windows-latest" })).toBe(60);
    expect(jobKey(all.build, "timeout-minutes")).toBe("60");
  });

  it("holds no secret and no environment where the tag and the gate are checked", () => {
    const { check } = all;
    expect(check).not.toMatch(SECRET);
    expect(check).not.toMatch(/^\s*environment:/m);
    // The checks come in this order, all before any job that builds.
    const order = [
      "Check the tag's shape and that it exists",
      "Read which systems a real run must sign",
      "Check the approval gate",
    ].map((name) => check.indexOf(`- name: ${name}`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(jobKey(all.build, "needs")).toBe("check");
    expect(jobKey(all.sign, "needs")).toBe("check");
  });
});

/** The `run:` block of the build job's step called `name`, with its indentation removed. */
function stepScript(name) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  const run = lines.findIndex((l, i) => i > start && /^\s+run: \|$/.test(l));
  const indent = lines[run].search(/\S/);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= indent) break;
    body.push(line.slice(indent + 2));
  }
  return body.join("\n");
}

const set = (names) => Object.fromEntries(names.map((n) => [n, `dummy-${n}`]));

/**
 * Runs the build step as written, on `os`, with dummy secrets and packaging replaced by a stub
 * that reports which signing variables it was given.
 */
function runBuildStep(os, secrets) {
  const dir = mkdtempSync(join(tmpdir(), "codeharden-desktop-step-"));
  try {
    const stub =
      'pnpm() { echo "PACKAGED_WITH:$(env | grep -oE "^(CSC_[A-Z_]+|APPLE_[A-Z_]+|WIN_CSC_[A-Z_]+)" | sort | tr "\\n" " ")"; }; ls() { :; }';
    const empty = Object.fromEntries([...MAC, ...WIN].map((n) => [n, ""]));
    const result = spawnSync("bash", ["-c", `${stub}\n${stepScript("Build the installers")}`], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        RUNNER_OS: os,
        GITHUB_ENV: join(dir, "github-env"),
        ...empty,
        ...secrets,
      },
    });
    let exported = "";
    try {
      exported = readFileSync(join(dir, "github-env"), "utf8");
    } catch {
      // nothing exported
    }
    const packaged = /PACKAGED_WITH:(.*)/.exec(result.stdout)?.[1].trim();
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      packagedWith: packaged === undefined ? null : packaged.split(" ").filter(Boolean),
      strict: exported.includes("REQUIRE_DEVELOPER_ID=1"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the build step's signing guards, run as written", () => {
  it("builds unsigned on every system when no secret is set", () => {
    for (const os of ["macOS", "Windows", "Linux"]) {
      expect(runBuildStep(os, {})).toMatchObject({ status: 0, packagedWith: [], strict: false });
    }
  });

  it("signs and notarizes on macOS with all five secrets, and turns the strict check on", () => {
    const run = runBuildStep("macOS", { ...set(MAC), ...set(WIN) });
    expect(run.status).toBe(0);
    expect(run.packagedWith).toEqual([...MAC].sort());
    expect(run.strict).toBe(true);
  });

  it("stops on macOS before packaging when only some of the five are set, naming the rest", () => {
    for (const present of [["CSC_LINK", "CSC_KEY_PASSWORD"], ["APPLE_ID"], MAC.slice(0, 4)]) {
      const run = runBuildStep("macOS", set(present));
      expect(run.status).toBe(1);
      expect(run.packagedWith).toBeNull();
      expect(run.strict).toBe(false);
      expect(run.output).toContain("macOS signing is half configured");
      for (const name of MAC.filter((n) => !present.includes(n))) {
        expect(run.output).toMatch(new RegExp(`Missing secrets:[^.]*\\b${name}\\b`));
      }
      expect(run.output).not.toContain("dummy-");
    }
  });

  it("never hands the Apple certificate to Windows or Linux", () => {
    expect(runBuildStep("Windows", set(MAC))).toMatchObject({
      status: 0,
      packagedWith: [],
      strict: false,
    });
    expect(runBuildStep("Linux", { ...set(MAC), ...set(WIN) })).toMatchObject({
      status: 0,
      packagedWith: [],
      strict: false,
    });
    expect(runBuildStep("Windows", { ...set(MAC), ...set(WIN) }).packagedWith).toEqual(
      [...WIN].sort(),
    );
  });

  it("stops on Windows when only one of its two secrets is set", () => {
    const run = runBuildStep("Windows", set(["WIN_CSC_LINK"]));
    expect(run.status).toBe(1);
    expect(run.packagedWith).toBeNull();
    expect(run.output).toContain("Missing secrets: WIN_CSC_KEY_PASSWORD");
    expect(run.output).not.toContain("dummy-");
  });
});

/**
 * Runs the step called `name` as written, with `gh` replaced by a function that answers from
 * `fixtures` (`test-support/stub-gh-installers.sh`: GitHub's answers as JSON, filtered by the
 * step's own `--jq` with the real `jq`).
 */
function runStep(name, env, fixtures = {}) {
  const dir = mkdtempSync(join(tmpdir(), "codeharden-desktop-step-"));
  try {
    const result = spawnSync("bash", ["-c", `. "$STUB_GH"\n${stepScript(name)}`], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        STUB_GH: STUB_GH_INSTALLERS,
        GITHUB_OUTPUT: join(dir, "github-output"),
        GITHUB_REPOSITORY: "example/example-harden",
        GITHUB_REF: "refs/heads/harden",
        DEFAULT_BRANCH: "harden",
        CODEHARDEN_REPO: "harperaa/codeharden",
        ...fixtures,
        ...env,
      },
    });
    let output = "";
    try {
      output = readFileSync(join(dir, "github-output"), "utf8");
    } catch {
      // nothing set
    }
    return {
      status: result.status,
      log: result.stdout + result.stderr,
      outputs: Object.fromEntries(
        output
          .split("\n")
          .filter(Boolean)
          .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
      ),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hasJq = spawnSync("jq", ["--version"]).status === 0;
const STUB_GH_INSTALLERS = fileURLToPath(
  new URL("./test-support/stub-gh-installers.sh", import.meta.url),
);

/** An environment as GitHub's "Get an environment" returns it. */
const environment = ({ reviewers = 1, branches = "selected", bypass = false } = {}) =>
  JSON.stringify({
    name: "release",
    can_admins_bypass: bypass,
    protection_rules: [
      ...(branches !== "any" ? [{ id: 1, type: "branch_policy" }] : []),
      ...(reviewers
        ? [
            {
              id: 2,
              type: "required_reviewers",
              prevent_self_review: false,
              reviewers: Array.from({ length: reviewers }, (_, i) => ({
                type: "User",
                reviewer: { id: i + 1 },
              })),
            },
          ]
        : []),
    ],
    deployment_branch_policy:
      branches === "any"
        ? null
        : {
            protected_branches: branches === "protected",
            custom_branch_policies: branches === "selected",
          },
  });

/** The environment's own branch and tag rules, as "List deployment branch policies" returns them. */
const policies = (...rules) =>
  JSON.stringify({
    total_count: rules.length,
    branch_policies: rules.map(([type, name], i) => ({ id: i + 1, name, type })),
  });
const ONLY_HARDEN = policies(["branch", "harden"]);

// CI's runners have `jq`; a computer without it skips these (they need GitHub's own filter).
describe.skipIf(!hasJq)("the check job's steps, run as written", () => {
  const tag = (fixtures, env = {}) =>
    runStep(
      "Check the tag's shape and that it exists",
      { TAG: "v2026.0105.0518", PACKAGE_NAME: "example-harden", ...env },
      {
        FIXTURE_TAG_SHA: TAG_SHA,
        FIXTURE_HEAD_SHA: HEAD_SHA,
        FIXTURE_AHEAD_BY: "0",
        FIXTURE_VERSION: "2026.0105.0518",
        ...fixtures,
      },
    );

  it("passes a release tag of the default branch on, with the commit it names", () => {
    const run = tag({});
    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({
      tag: "v2026.0105.0518",
      sha: TAG_SHA,
      version: "2026.0105.0518",
      npm_version: "2026.105.518",
    });
  });

  it("refuses a tag whose commit the default branch does not contain", () => {
    const run = tag({ FIXTURE_AHEAD_BY: "3" });
    expect(run.status).toBe(1);
    expect(run.log).toContain("v2026.0105.0518 is not a commit of harden");
    expect(run.outputs).toEqual({});
  });

  it("refuses a tag that does not exist, has another VERSION or the wrong shape", () => {
    expect(tag({ FIXTURE_TAG_SHA: "" })).toMatchObject({ status: 1, outputs: {} });
    expect(tag({ FIXTURE_VERSION: "2026.0105.0001" })).toMatchObject({ status: 1, outputs: {} });
    const shaped = tag({}, { TAG: "v1.2.3; echo pwned" });
    expect(shaped.status).toBe(1);
    expect(shaped.log).not.toMatch(/^pwned$/m);
  });

  const signing = (value) =>
    runStep("Read which systems a real run must sign", { SIGNED_INSTALLERS: value });

  it("requires a signed macOS app unless the repository says otherwise", () => {
    expect(signing("")).toMatchObject({ status: 0, outputs: { must_sign: "macos" } });
    expect(signing("macos")).toMatchObject({ status: 0, outputs: { must_sign: "macos" } });
    expect(signing("macos windows").outputs.must_sign).toBe("macos windows");
    expect(signing("windows,macos, windows").outputs.must_sign).toBe("windows macos");
    expect(signing("none")).toMatchObject({ status: 0, outputs: { must_sign: "" } });
  });

  it("stops on a SIGNED_INSTALLERS value it does not know", () => {
    for (const value of ["linux", "macos none", "all", "macos; echo pwned"]) {
      const run = signing(value);
      expect(run.status).toBe(1);
      expect(run.outputs).toEqual({});
      expect(run.log).toContain("SIGNED_INSTALLERS must be");
      expect(run.log).not.toMatch(/^pwned$/m);
    }
  });

  const gate = (env, fixture, rules = ONLY_HARDEN) =>
    runStep(
      "Check the approval gate",
      { DRY_RUN: "false", RELEASE_APPROVAL: "", ...env },
      fixture === undefined ? {} : { FIXTURE_ENVIRONMENT: fixture, FIXTURE_BRANCH_POLICIES: rules },
    );

  it("lets a real run start when the environment requires a review and restricts branches", () => {
    const run = gate({}, environment());
    expect(run.status).toBe(0);
    expect(run.log).toContain("a real run waits for an approval");
    expect(run.log).not.toContain("::error::");
    expect(run.log).not.toContain("::warning::");
  });

  it("refuses a real run when the environment is missing: GitHub would create it unprotected", () => {
    const run = gate({});
    expect(run.status).toBe(1);
    expect(run.log).toContain('::error::The environment "release" does not exist');
  });

  it("refuses a real run without required reviewers or without a branch rule", () => {
    const open = gate({}, environment({ reviewers: 0 }));
    expect(open.status).toBe(1);
    expect(open.log).toContain("has no required reviewers");
    const anyBranch = gate({}, environment({ branches: "any" }));
    expect(anyBranch.status).toBe(1);
    expect(anyBranch.log).toContain("lets every branch use it");
    // The environment as GitHub creates it by itself: no rules at all.
    const bare = gate(
      {},
      JSON.stringify({ name: "release", protection_rules: [], deployment_branch_policy: null }),
    );
    expect(bare.status).toBe(1);
    expect(bare.log).toContain("has no required reviewers");
    expect(bare.log).toContain("lets every branch use it");
  });

  it("refuses a real run unless the default branch alone may use the environment", () => {
    // "Protected branches only" admits every protected branch, and every branch when none is.
    const protectedOnly = gate({}, environment({ branches: "protected" }));
    expect(protectedOnly.status).toBe(1);
    expect(protectedOnly.log).toContain("lets every protected branch use it");
    // Its own rules, but more than the one that names the default branch.
    for (const [rules, named] of [
      [policies(["branch", "harden"], ["branch", "someone/patch"]), "branch someone/patch"],
      [policies(["branch", "*"]), "branch *"],
      [policies(["branch", "harden*"]), "branch harden*"],
      [policies(["tag", "harden"]), "tag harden"],
      [policies(["branch", "harden"], ["tag", "v*"]), "tag v*"],
      [policies(["branch", "main"]), "branch main"],
      [policies(), "no branch at all"],
    ]) {
      const run = gate({}, environment(), rules);
      expect(run.status).toBe(1);
      expect(run.log).toContain('::error::The environment "release" may be used by:');
      expect(run.log).toContain(named);
      expect(run.log).not.toContain("a real run waits for an approval");
    }
    // Rules that can't be read are not a pass.
    const unread = gate({}, environment(), "");
    expect(unread.status).toBe(1);
    expect(unread.log).toContain("can't be read");
    // Another default branch: its own name is the one rule.
    const other = gate(
      { DEFAULT_BRANCH: "trunk", GITHUB_REF: "refs/heads/trunk" },
      environment(),
      policies(["branch", "trunk"]),
    );
    expect(other.status).toBe(0);
    expect(
      gate({ DEFAULT_BRANCH: "trunk", GITHUB_REF: "refs/heads/trunk" }, environment()).status,
    ).toBe(1);
  });

  it("refuses a real run started on another branch than the default one", () => {
    const run = gate({ GITHUB_REF: "refs/heads/someone/patch" }, environment());
    expect(run.status).toBe(1);
    expect(run.log).toContain("::error::A real run must be started on harden");
    expect(gate({ GITHUB_REF: "refs/tags/harden" }, environment()).status).toBe(1);
  });

  it("only warns about administrators' bypass", () => {
    const run = gate({}, environment({ bypass: true }));
    expect(run.status).toBe(0);
    expect(run.log).toContain("::warning::");
    expect(run.log).toContain("lets administrators start its jobs without a review");
  });

  it("never stops a dry run: it reports what a real run would stop on", () => {
    for (const [env, fixture] of [
      [{}, undefined],
      [{}, environment({ reviewers: 0, branches: "any" })],
      [{ GITHUB_REF: "refs/heads/someone/patch" }, environment()],
    ]) {
      const run = gate({ DRY_RUN: "true", ...env }, fixture);
      expect(run.status).toBe(0);
      expect(run.log).toContain("::warning::A real run would stop here.");
      expect(run.log).not.toContain("::error::");
    }
    expect(gate({ DRY_RUN: "true" }, environment()).log).not.toContain("::warning::");
  });

  it("skips the environment's rules only when the repository says it publishes unapproved", () => {
    const none = gate({ RELEASE_APPROVAL: "none" });
    expect(none.status).toBe(0);
    expect(none.log).toContain("::notice::RELEASE_APPROVAL is none");
    expect(gate({ RELEASE_APPROVAL: "required" }).status).toBe(1);
    // Still on the default branch only, and no other spelling switches the check off.
    expect(gate({ RELEASE_APPROVAL: "none", GITHUB_REF: "refs/heads/x" }).status).toBe(1);
    for (const value of ["off", "false", "None", "no"]) {
      const run = gate({ RELEASE_APPROVAL: value }, environment());
      expect(run.status).toBe(1);
      expect(run.log).toContain("RELEASE_APPROVAL must be");
    }
    for (const dryRun of ["true", "false"]) {
      expect(gate({ RELEASE_APPROVAL: "off", DRY_RUN: dryRun }, environment()).status).toBe(1);
    }
  });
});

describe("the signing jobs' first step, run as written", () => {
  const first = (os, mustSign, has) =>
    runStep("Check that the environment has the signing secrets", {
      RUNNER_OS: os,
      MUST_SIGN: mustSign,
      HAS_SIGNING_SECRETS: has,
    });

  it("stops a real run whose environment has no secrets for a system that must be signed", () => {
    const mac = first("macOS", "macos", "false");
    expect(mac.status).toBe(1);
    expect(mac.log).toContain('::error::The environment "release" has no macos signing secrets');
    const win = first("Windows", "macos windows", "false");
    expect(win.status).toBe(1);
    expect(win.log).toContain("has no windows signing secrets");
    // An empty answer (the expression could not be read) is not a yes.
    expect(first("macOS", "macos", "").status).toBe(1);
  });

  it("goes on when the secrets are set, or the system may be published unsigned", () => {
    expect(first("macOS", "macos", "true").status).toBe(0);
    expect(first("Windows", "macos windows", "true").status).toBe(0);
    expect(first("Windows", "macos", "false").status).toBe(0);
    expect(first("macOS", "", "false").status).toBe(0);
    expect(first("macOS", "windows", "false").status).toBe(0);
  });

  it("comes before anything is checked out or installed", () => {
    const { build } = jobs(workflow);
    const at = (text) => build.indexOf(text);
    expect(at("- name: Check that the environment has the signing secrets")).toBeGreaterThan(-1);
    expect(at("- name: Check that the environment has the signing secrets")).toBeLessThan(
      at("actions/checkout"),
    );
    expect(at("actions/checkout")).toBeLessThan(at("pnpm install"));
  });
});
