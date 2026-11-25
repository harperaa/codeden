import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Project, SecureFoundationRepoSecrets } from "@codeden/contracts";
import { afterAll, describe, expect, it } from "vitest";
import type { CliResult } from "../src/services/secure-foundation/connections/process";
import { existingNames, listArgs } from "../src/services/secure-foundation/repo-secrets/github";
import { RepoSecretsService } from "../src/services/secure-foundation/repo-secrets/repo-secrets-service";
import { scanWorkflows, stripComment } from "../src/services/secure-foundation/repo-secrets/scan";
import {
  MAX_WORKFLOW_BYTES,
  MAX_WORKFLOW_FILES,
  readWorkflowFiles,
} from "../src/services/secure-foundation/repo-secrets/workflow-files";
import { removeTree } from "./support/remove-tree";

/**
 * The repository secrets a Secure Foundation project's workflows need: the scan of the workflow
 * files (text only), the question to GitHub (a scripted `gh`: names only, no network) and the
 * service that puts them together. No process is started and no clock is waited on.
 */

const scan = (text: string, name = "ci.yml") => scanWorkflows([{ name, text }]);
const names = (text: string) => scan(text).references.map((r) => `${r.kind}:${r.name}`);

/** The shape of the template's review workflow: two jobs on every pull request. */
const REVIEW = `name: Claude Code Review

on:
  pull_request:
    types: [opened, synchronize]
    # paths:
    #   - "src/**/*.ts"

jobs:
  security-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Security Review
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: |
            REPO: \${{ github.repository }}

  claude-review:
    # if: github.event.pull_request.user.login == 'someone'
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
`;

/** The shape of the template's mention workflow: one job, only where something says @claude. */
const MENTION = `name: Claude Code
on:
  issue_comment:
    types: [created]
  issues:
    types: [opened, assigned]
jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@claude') || contains(github.event.issue.title, '@claude')))
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
`;

/** The shape of the template's CI: a build that reads a token through `env:`. */
const CI = `name: CI
on:
  push:
    branches: [main, testing]
  pull_request:
    branches: [main, testing]
permissions:
  contents: read
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint
  build:
    needs: [lint]
    runs-on: ubuntu-latest
    env:
      DOPPLER_TOKEN: \${{ secrets.DOPPLER_TOKEN }}
    steps:
      - uses: actions/checkout@v4
        with:
          # token: \${{ secrets.SYNC_TOKEN }}
          fetch-depth: 0
      # so \`secrets.DOPPLER_TOKEN\` is ALWAYS empty here
      - name: Build
        if: env.DOPPLER_TOKEN != ''
        run: doppler run -- npm run build
`;

describe("the scan of the workflow files", () => {
  it("finds a secret passed in `with:`, with its jobs and what starts them", () => {
    expect(scan(REVIEW, "claude-code-review.yml").references).toEqual([
      {
        kind: "secret",
        name: "CLAUDE_CODE_OAUTH_TOKEN",
        uses: [
          {
            workflow: "claude-code-review.yml",
            jobs: ["security-review", "claude-review"],
            events: [{ name: "pull_request", filtered: false }],
            mention: null,
          },
        ],
      },
    ]);
  });

  it("finds a secret passed in `env:`, and sees that the events are narrowed to branches", () => {
    const [reference] = scan(CI).references;
    expect(reference).toMatchObject({ kind: "secret", name: "DOPPLER_TOKEN" });
    expect(reference?.uses).toEqual([
      {
        workflow: "ci.yml",
        jobs: ["build"],
        events: [
          { name: "push", filtered: true },
          { name: "pull_request", filtered: true },
        ],
        mention: null,
      },
    ]);
  });

  it("ignores comments: a whole line, the end of a line, and a commented-out reference", () => {
    // `SYNC_TOKEN` and the sentence about `secrets.DOPPLER_TOKEN` are comments in CI.
    expect(names(CI)).toEqual(["secret:DOPPLER_TOKEN"]);
    expect(
      names(`on: push\njobs:\n  a:\n    env:\n      X: 1 # was \${{ secrets.OLD_TOKEN }}\n`),
    ).toEqual([]);
    expect(stripComment("run: echo '# not a comment' # a comment")).toBe(
      "run: echo '# not a comment' ",
    );
    expect(stripComment('run: echo "a # b" && echo c#d')).toBe('run: echo "a # b" && echo c#d');
    // An apostrophe inside a word opens no quote, so the comment after it is still one.
    expect(stripComment(`name: Don't # \${{ secrets.X }}`)).toBe("name: Don't ");
  });

  it("says when a job only runs where something mentions a name", () => {
    const [reference] = scan(MENTION, "claude.yml").references;
    expect(reference?.uses[0]).toMatchObject({ jobs: ["claude"], mention: "@claude" });
    // One alternative without the mention, and it isn't "only when mentioned" any more.
    const open = MENTION.replace(
      "(github.event_name == 'issues' &&",
      "github.event_name == 'push' || (github.event_name == 'issues' &&",
    );
    expect(scan(open).references[0]?.uses[0]?.mention).toBeNull();
  });

  it("finds references in `if:` conditions, with and without an expression's braces", () => {
    const text = `on: [push, workflow_dispatch]
jobs:
  deploy:
    if: secrets.DEPLOY_KEY != '' && vars.DEPLOY_ENABLED == 'true'
    runs-on: ubuntu-latest
    steps:
      - name: one
        if: \${{ secrets.STEP_ONE != '' }}
        run: echo one
      - if: |
          vars.REGION == 'eu' &&
          secrets.STEP_TWO != ''
        run: echo two
        name: secrets.NOT_AN_EXPRESSION
`;
    expect(names(text)).toEqual([
      "secret:DEPLOY_KEY",
      "secret:STEP_ONE",
      "secret:STEP_TWO",
      "variable:DEPLOY_ENABLED",
      "variable:REGION",
    ]);
    expect(scan(text).references[0]?.uses[0]?.events).toEqual([
      { name: "push", filtered: false },
      { name: "workflow_dispatch", filtered: false },
    ]);
  });

  it("reads the quoted and bracket forms, in any case, across lines", () => {
    const text = `"on":
  - push
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: deploy
        env:
          A: \${{ secrets['BRACKET_SINGLE'] }}
          B: "\${{ secrets["BRACKET_DOUBLE"] }}"
          C: '\${{ SECRETS.lower_case }}'
          D: \${{ format('{0}-{1}', vars [ 'SPACED' ],
            secrets.NEXT_LINE) }}
          E: \${{secrets.TIGHT}}\${{ vars.TWO_IN_ONE }}
`;
    expect(names(text)).toEqual([
      "secret:BRACKET_DOUBLE",
      "secret:BRACKET_SINGLE",
      "secret:LOWER_CASE",
      "secret:NEXT_LINE",
      "secret:TIGHT",
      "variable:SPACED",
      "variable:TWO_IN_ONE",
    ]);
    expect(scan(text).references[0]?.uses[0]?.events).toEqual([{ name: "push", filtered: false }]);
  });

  it("reads past braces inside a quoted string, and takes no name from inside one", () => {
    const text = `on: push
jobs:
  a:
    if: contains(github.event.head_commit.message, 'vars.IN_A_STRING') && vars.REAL_VAR == 'secrets.ALSO_TEXT'
    steps:
      - run: deploy
        env:
          A: \${{ format('{{"token":"{0}"}}', secrets.AFTER_BRACES) }}
          B: \${{ 'secrets.ONLY_TEXT' }}
          C: \${{ format('{0} secrets.IN_FORMAT', secrets [ 'INDEXED' ]) }}
          D: '\${{ contains(github.ref, ''secrets.DOUBLED'') && secrets.IN_YAML_QUOTES }}'
          E: '\${{ format(''{{0}} }} secrets.DOUBLED_TOO'', 1) }}'
      - if: 'secrets.YAML_QUOTED != '''''
        run: echo quoted by YAML
`;
    expect(names(text)).toEqual([
      "secret:AFTER_BRACES",
      "secret:IN_YAML_QUOTES",
      "secret:INDEXED",
      "secret:YAML_QUOTED",
      "variable:REAL_VAR",
    ]);
  });

  it("only says a job waits for a mention when its condition asks for one", () => {
    const job = (condition: string) =>
      scan(
        `on: issue_comment\njobs:\n  a:\n    if: ${condition}\n    env:\n      T: \${{ secrets.T }}\n`,
      ).references[0]?.uses[0]?.mention;
    const body = "github.event.comment.body";
    expect(job(`contains(${body}, '@claude')`)).toBe("@claude");
    expect(job(`\${{ github.actor != 'x' && contains(${body}, '@claude') }}`)).toBe("@claude");
    // Negated, it runs where the mention is absent.
    expect(job(`\${{ !contains(${body}, '@claude') }}`)).toBeNull();
    expect(job(`! contains(${body}, '@claude')`)).toBeNull();
    expect(job(`\${{ !(contains(${body}, '@claude') && github.actor == 'x') }}`)).toBeNull();
    // The name only stands beside a test, or two names are asked for.
    expect(job(`contains(${body}, 'x') && github.actor != '@claude'`)).toBeNull();
    expect(job(`contains(${body}, '@claude') || contains(${body}, '@other')`)).toBeNull();
    expect(job(`contains(${body}, '@claude') && !contains(${body}, '@claude')`)).toBeNull();
  });

  it("leaves out the token GitHub provides, and what only looks like a reference", () => {
    const text = `on: push
env:
  TOKEN: \${{ secrets.GITHUB_TOKEN }}
  OTHER: \${{ secrets.github_token }}
jobs:
  a:
    steps:
      - run: echo "read docs/secrets.md and vars.txt"
      - run: echo \${{ steps.x.outputs.secrets.inner }} \${{ mysecrets.other }} \${{ env.vars.x }}
      - run: echo \${{ toJSON(secrets) }}
`;
    expect(scan(text)).toEqual({ references: [], inherits: [], refused: 0 });
  });

  it("refuses names with odd characters, and counts them", () => {
    const text = `on: push
jobs:
  a:
    steps:
      - run: x
        env:
          A: \${{ secrets['my token'] }}
          B: \${{ secrets['TOKEN; rm -rf ~'] }}
          C: \${{ secrets.WITH-DASH }}
          D: \${{ secrets['$(id)'] }}
          E: \${{ vars['../../x'] }}
          F: \${{ secrets.FINE }}
`;
    const result = scan(text);
    expect(result.references.map((r) => r.name)).toEqual(["FINE"]);
    expect(result.refused).toBe(5);
  });

  it("says a secret used outside a job is used by the whole workflow", () => {
    const text = `on:
  schedule:
    - cron: "0 4 * * *"
env:
  API_KEY: \${{ secrets.API_KEY }}
jobs:
  nightly:
    steps:
      - run: echo \${{ secrets.API_KEY }}
`;
    expect(scan(text).references[0]?.uses).toEqual([
      {
        workflow: "ci.yml",
        jobs: [],
        events: [{ name: "schedule", filtered: false }],
        mention: null,
      },
    ]);
  });

  it("reports a job that hands every secret to a workflow it calls", () => {
    const text = `on:
  workflow_dispatch:
jobs:
  call:
    uses: ./.github/workflows/release.yml
    secrets: inherit
  named:
    uses: ./.github/workflows/release.yml
    secrets:
      token: \${{ secrets.RELEASE_TOKEN }}
  quoted:
    uses: octo/shared/.github/workflows/x.yml@v1
    secrets: "inherit"
`;
    const result = scan(text, "release-call.yml");
    expect(result.inherits).toEqual([
      { workflow: "release-call.yml", job: "call" },
      { workflow: "release-call.yml", job: "quoted" },
    ]);
    expect(result.references.map((r) => [r.name, r.uses[0]?.jobs])).toEqual([
      ["RELEASE_TOKEN", ["named"]],
    ]);
  });

  it("puts one name used by several files together, secrets before variables", () => {
    const result = scanWorkflows([
      { name: "claude-code-review.yml", text: REVIEW },
      { name: "claude.yml", text: MENTION },
      { name: "ci.yml", text: CI },
      { name: "vars.yml", text: `on: push\njobs:\n  a:\n    env:\n      R: \${{ vars.REGION }}\n` },
    ]);
    expect(result.references.map((r) => `${r.kind}:${r.name}:${r.uses.length}`)).toEqual([
      "secret:CLAUDE_CODE_OAUTH_TOKEN:2",
      "secret:DOPPLER_TOKEN:1",
      "variable:REGION:1",
    ]);
  });

  it("doesn't crash on junk, and finds nothing in it", () => {
    const junk = [
      "",
      "\u0000\u0001\u0002",
      "}}{{ ${{ ${{ ${{",
      "${{ secrets.",
      "${{ secrets[",
      "${{ secrets['unterminated",
      ":\n:\n  :\n\t\t- - -\n",
      "jobs:\njobs:\n  jobs:\n    if:\n",
      "on:\n\ton:\n  - \n  - - -\n",
      "!!python/object/apply:os.system ['id']\n&a [*a, *a]\n",
      `jobs:\n${"  x:\n".repeat(5_000)}`,
      "${{".repeat(20_000),
      `if: ${"secrets[".repeat(20_000)}`,
      `if: ${"vars.[ ".repeat(20_000)}`,
      "a".repeat(300_000),
      // Thousands of expressions that never close, each overlapping the next.
      "${{ x ".repeat(40_000),
      `on: push\njobs:\n  a:\n    if: ${"(".repeat(10_000)}\n`,
    ];
    for (const text of junk) {
      expect(() => scan(text), JSON.stringify(text.slice(0, 30))).not.toThrow();
      expect(scan(text).references).toEqual([]);
    }
    // A custom tag is text like any other: the reference beside it is still found.
    expect(names(`on: push\nenv:\n  A: !!js/function \${{ secrets.BESIDE_A_TAG }}\n`)).toEqual([
      "secret:BESIDE_A_TAG",
    ]);
  });
});

describe("the workflow files that are read", () => {
  const roots: string[] = [];
  const project = () => {
    const root = mkdtempSync(join(tmpdir(), "repo-secrets-"));
    roots.push(root);
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    return root;
  };
  afterAll(async () => {
    for (const root of roots) await removeTree(root);
  });

  it("reads `.yml` and `.yaml` files of the project's own workflows folder, in order", () => {
    const root = project();
    const dir = join(root, ".github", "workflows");
    writeFileSync(join(dir, "b.yaml"), "on: push\n");
    writeFileSync(join(dir, "a.yml"), "on: push\n");
    writeFileSync(join(dir, "notes.md"), `\${{ secrets.NOT_A_WORKFLOW }}\n`);
    mkdirSync(join(dir, "nested.yml"));
    expect(readWorkflowFiles(root)).toEqual({
      files: [
        { name: "a.yml", text: "on: push\n" },
        { name: "b.yaml", text: "on: push\n" },
      ],
      skipped: 0,
    });
  });

  it("skips a file that is too large, binary or oddly named, and counts it", () => {
    const root = project();
    const dir = join(root, ".github", "workflows");
    writeFileSync(join(dir, "ok.yml"), "on: push\n");
    writeFileSync(join(dir, "big.yml"), "a".repeat(MAX_WORKFLOW_BYTES + 1));
    writeFileSync(join(dir, "binary.yml"), Buffer.from([111, 110, 0, 58]));
    writeFileSync(join(dir, "odd`name.yml"), "on: push\n");
    const read = readWorkflowFiles(root);
    expect(read.files.map((f) => f.name)).toEqual(["ok.yml"]);
    expect(read.skipped).toBe(3);
  });

  it("reads no more files than its limit", () => {
    const root = project();
    const dir = join(root, ".github", "workflows");
    for (let i = 0; i < MAX_WORKFLOW_FILES + 3; i++) {
      writeFileSync(join(dir, `w${String(i).padStart(3, "0")}.yml`), "on: push\n");
    }
    const read = readWorkflowFiles(root);
    expect(read.files).toHaveLength(MAX_WORKFLOW_FILES);
    expect(read.skipped).toBe(3);
  });

  it.runIf(process.platform !== "win32")("never reads through a link", () => {
    const outside = mkdtempSync(join(tmpdir(), "repo-secrets-outside-"));
    roots.push(outside);
    writeFileSync(join(outside, "secret.yml"), `env:\n  A: \${{ secrets.FROM_OUTSIDE }}\n`);
    // A linked file inside a real folder.
    const linkedFile = project();
    symlinkSync(join(outside, "secret.yml"), join(linkedFile, ".github", "workflows", "link.yml"));
    expect(readWorkflowFiles(linkedFile).files).toEqual([]);
    // A linked workflows folder, and a linked `.github`.
    for (const link of [[".github", "workflows"], [".github"]]) {
      const root = mkdtempSync(join(tmpdir(), "repo-secrets-"));
      roots.push(root);
      if (link.length === 2) mkdirSync(join(root, ".github"));
      symlinkSync(outside, join(root, ...link));
      expect(readWorkflowFiles(root)).toEqual({ files: [], skipped: 0 });
    }
  });

  it("gives nothing for a project without workflows", () => {
    const root = mkdtempSync(join(tmpdir(), "repo-secrets-"));
    roots.push(root);
    expect(readWorkflowFiles(root)).toEqual({ files: [], skipped: 0 });
    expect(readWorkflowFiles(join(root, "gone"))).toEqual({ files: [], skipped: 0 });
  });
});

const ok = (output: string): CliResult => ({ code: 0, output, notFound: false, timedOut: false });
const failed = (output: string, code = 1): CliResult => ({
  code,
  output,
  notFound: false,
  timedOut: false,
});

describe("asking GitHub which names exist", () => {
  it("runs one fixed command per kind, and asks for names only", async () => {
    expect(listArgs("secret", "octo/my-site")).toEqual([
      "secret",
      "list",
      "--repo",
      "octo/my-site",
      "--json",
      "name",
    ]);
    expect(listArgs("variable", "octo/my-site")).toEqual([
      "variable",
      "list",
      "--repo",
      "octo/my-site",
      "--json",
      "name",
    ]);
    const asked: string[][] = [];
    const result = await existingNames(
      async (args) => {
        asked.push([...args]);
        return ok('[{"name":"DOPPLER_TOKEN"},{"name":"lower_case"}]\n');
      },
      "secret",
      "octo/my-site",
    );
    expect(asked).toEqual([["secret", "list", "--repo", "octo/my-site", "--json", "name"]]);
    expect([...(result.names ?? [])]).toEqual(["DOPPLER_TOKEN", "LOWER_CASE"]);
    expect(result.problem).toBeNull();
  });

  it("keeps only plain names, whatever else the answer holds", async () => {
    const answer = JSON.stringify([
      { name: "GOOD", value: "never-kept", updatedAt: "2026-01-01" },
      { name: "bad name" },
      { name: "X;id" },
      { name: 7 },
      { other: "NAME" },
      "TEXT",
      null,
    ]);
    const result = await existingNames(async () => ok(answer), "variable", "octo/my-site");
    expect([...(result.names ?? [])]).toEqual(["GOOD"]);
    expect(JSON.stringify([...(result.names ?? [])])).not.toContain("never-kept");
  });

  it("reads an empty list as none set", async () => {
    const result = await existingNames(async () => ok("[]\n"), "secret", "octo/my-site");
    expect(result).toEqual({ names: new Set(), problem: null });
  });

  it.each([
    [
      "gh is not installed",
      { code: null, output: "", notFound: true, timedOut: false },
      /isn't installed/,
    ],
    [
      "gh is signed out",
      failed("To get started with GitHub CLI, please run:  gh auth login\n", 4),
      /isn't signed in/,
    ],
    ["the sign-in can't read it", failed("HTTP 403: Resource not accessible\n"), /can't read/],
    ["the repository is gone", failed("HTTP 404: Not Found\n"), /isn't there/],
    ["it took too long", { code: null, output: "", notFound: false, timedOut: true }, /too long/],
    ["it printed something else", ok("not json"), /didn't answer/],
    ["it printed an object", ok('{"name":"X"}'), /didn't answer/],
    ["it failed with a list in its output", failed('[{"name":"X"}]'), /didn't answer/],
  ])("says so when %s, and knows nothing then", async (_label, result, problem) => {
    const answer = await existingNames(async () => result as CliResult, "secret", "octo/my-site");
    expect(answer.names).toBeNull();
    expect(answer.problem).toMatch(problem);
    // What gh printed is never repeated.
    expect(answer.problem).not.toContain("Resource not accessible");
  });

  it("never throws when gh itself does", async () => {
    const answer = await existingNames(
      async () => {
        throw new Error("spawn failed");
      },
      "secret",
      "octo/my-site",
    );
    expect(answer).toEqual({ names: null, problem: "GitHub couldn't be asked." });
  });
});

const github = (owner = "octo", repo = "my-site") =>
  ({
    id: "p1",
    name: "My Site",
    path: "/projects/my-site",
    kind: "github",
    github: {
      owner,
      repo,
      remoteUrl: `https://github.com/${owner}/${repo}.git`,
      defaultBranch: "main",
    },
  }) as unknown as Project;
const local = {
  id: "p1",
  name: "My Site",
  path: "/projects/my-site",
  kind: "local",
} as unknown as Project;

const TEMPLATE_FILES = [
  { name: "ci.yml", text: CI },
  { name: "claude-code-review.yml", text: REVIEW },
  { name: "claude.yml", text: MENTION },
];

function setup(
  over: {
    project?: Project | null;
    secrets?: "doppler" | "env_local" | null;
    files?: Array<{ name: string; text: string }>;
    answer?: (args: readonly string[]) => CliResult;
  } = {},
) {
  const asked: string[][] = [];
  let reads = 0;
  let clock = Date.parse("2026-01-05T10:00:00.000Z");
  let project = over.project === undefined ? github() : over.project;
  const service = new RepoSecretsService({
    projects: {
      get: () => {
        if (!project) throw new Error("no such project");
        return project;
      },
    },
    kept: () => (over.secrets === null ? null : { secrets: over.secrets ?? "doppler" }),
    gh: async (args) => {
      asked.push([...args]);
      return (over.answer ?? (() => ok('[{"name":"DOPPLER_TOKEN"}]')))(args);
    },
    now: () => new Date(clock),
    readWorkflows: () => {
      reads++;
      return { files: over.files ?? TEMPLATE_FILES, skipped: 0 };
    },
  });
  return {
    service,
    asked,
    reads: () => reads,
    later: (ms: number) => {
      clock += ms;
    },
    become: (next: Project | null) => {
      project = next;
    },
  };
}
const here = { local: true, setUp: () => true };

describe("what a project's workflows need, against what its repository has", () => {
  it("shows what the deploy stored as set and the rest as missing, each with its steps", async () => {
    const { service, asked } = setup();
    const result = await service.view("p1", here);
    expect(result).toMatchObject({
      applies: true,
      repository: "octo/my-site",
      github: "checked",
      message: null,
      checkedAt: "2026-01-05T10:00:00.000Z",
      canCheck: true,
    });
    expect(result.items.map((i) => `${i.name}:${i.state}`)).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN:missing",
      "DOPPLER_TOKEN:set",
    ]);
    const [claude] = result.items;
    expect(claude?.where).toContain("runs on every pull request");
    expect(claude?.where).toContain("only when someone mentions @claude");
    expect(claude?.steps.join(" ")).toContain("`claude setup-token`");
    expect(claude?.steps.join(" ")).toContain("--repo octo/my-site`");
    // One question, for secrets: no workflow uses a variable, so variables aren't listed.
    expect(asked).toEqual([["secret", "list", "--repo", "octo/my-site", "--json", "name"]]);
  });

  it("asks for variables only when a workflow uses one", async () => {
    const { service, asked } = setup({
      files: [
        { name: "v.yml", text: `on: push\njobs:\n  a:\n    env:\n      R: \${{ vars.REGION }}\n` },
      ],
      answer: () => ok("[]"),
    });
    const result = await service.view("p1", here);
    expect(result.items).toMatchObject([{ kind: "variable", name: "REGION", state: "missing" }]);
    expect(asked).toEqual([["variable", "list", "--repo", "octo/my-site", "--json", "name"]]);
  });

  it("asks nothing when the workflows use no secret at all", async () => {
    const { service, asked } = setup({ files: [{ name: "a.yml", text: "on: push\n" }] });
    expect(await service.view("p1", here)).toMatchObject({ github: "checked", items: [] });
    expect(asked).toEqual([]);
  });

  it("doesn't call a missing Doppler token missing in a project without Doppler", async () => {
    const { service } = setup({ secrets: "env_local", answer: () => ok("[]") });
    const result = await service.view("p1", here);
    expect(result.items.map((i) => `${i.name}:${i.state}`)).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN:missing",
      "DOPPLER_TOKEN:not_needed",
    ]);
  });

  it.each([
    ["gh is missing", { code: null, output: "", notFound: true, timedOut: false }],
    ["gh is signed out", failed("please run: gh auth login", 4)],
    ["the call fails", failed("HTTP 502")],
  ])("lists the names without knowing which are set when %s", async (_label, result) => {
    const { service } = setup({ answer: () => result as CliResult });
    const view = await service.view("p1", here);
    expect(view.github).toBe("unavailable");
    expect(view.message).toMatch(/^Which of these are already set couldn't be checked\./);
    // Nothing is hidden, and nothing is claimed.
    expect(view.items.map((i) => `${i.name}:${i.state}`)).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN:unknown",
      "DOPPLER_TOKEN:unknown",
    ]);
    expect(view.items[0]?.steps.length).toBeGreaterThan(0);
  });

  it("lists the names and asks GitHub nothing while the project has no repository", async () => {
    const { service, asked } = setup({ project: local });
    const result = await service.view("p1", here);
    expect(result).toMatchObject({ applies: true, repository: null, github: "no_repository" });
    expect(result.items.map((i) => `${i.name}:${i.state}:${i.steps.length}`)).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN:unknown:0",
      "DOPPLER_TOKEN:unknown:0",
    ]);
    expect(asked).toEqual([]);
  });

  it("never puts an odd owner or repository name into a command", async () => {
    for (const project of [
      github("octo", "site --json value"),
      github("octo", "site;id"),
      github("-R", "site"),
      github("octo/evil", "site"),
      github("octo", "$(id)"),
    ]) {
      const { service, asked } = setup({ project });
      expect((await service.view("p1", here)).github).toBe("no_repository");
      expect(asked).toEqual([]);
    }
  });

  it("is about Secure Foundation projects only: another project is not even read", async () => {
    const { service, asked, reads } = setup({ secrets: null });
    const other = { local: true, setUp: () => false };
    expect((await service.view("p1", other)).applies).toBe(false);
    expect((await service.check("p1", other)).applies).toBe(false);
    expect(reads()).toBe(0);
    expect(asked).toEqual([]);
    // A project made before the app kept anything still counts: it has a setup session.
    expect((await service.view("p1", here)).applies).toBe(true);
  });

  it("answers a project that is gone with nothing", async () => {
    const { service } = setup({ project: null });
    expect((await service.view("gone", here)).applies).toBe(false);
    expect((await service.check("gone", here)).applies).toBe(false);
  });

  it("shows the last result again for a while, and asks again on demand", async () => {
    const { service, asked, later } = setup();
    await service.view("p1", here);
    later(60_000);
    const again = await service.view("p1", here);
    expect(again.checkedAt).toBe("2026-01-05T10:00:00.000Z");
    expect(asked).toHaveLength(1);
    // "Check again" always asks.
    expect((await service.check("p1", here)).checkedAt).toBe("2026-01-05T10:01:00.000Z");
    expect(asked).toHaveLength(2);
    // And so does the page, once the result is old.
    later(5 * 60_000);
    expect((await service.view("p1", here)).checkedAt).toBe("2026-01-05T10:06:00.000Z");
    expect(asked).toHaveLength(3);
  });

  it("checks at once when the project gets its repository", async () => {
    const { service, asked, become } = setup({ project: local });
    expect((await service.view("p1", here)).github).toBe("no_repository");
    become(github());
    const result = await service.view("p1", here);
    expect(result).toMatchObject({ repository: "octo/my-site", github: "checked" });
    expect(asked).toHaveLength(1);
  });

  it("gives an answer that fits its contract however much the workflows hold", async () => {
    // More files, jobs, events and names than any limit of the answer.
    const events = Array.from({ length: 60 }, (_, i) => `  event_${"x".repeat(40)}_${i}:\n`);
    const jobs = Array.from({ length: 60 }, (_, j) => {
      const used = Array.from({ length: 80 }, (_, n) => `\${{ secrets.NAME_${n} }}`).join(" ");
      return `  job_${"y".repeat(80)}_${j}:\n    secrets: inherit\n    env:\n      A: ${used}\n`;
    });
    const text = `on:\n${events.join("")}jobs:\n${jobs.join("")}`;
    const files = Array.from({ length: 30 }, (_, f) => ({ name: `w${f}.yml`, text }));
    for (const answer of [() => ok("[]"), () => failed("HTTP 502")]) {
      const { service } = setup({ files, answer });
      const result = await service.view("p1", here);
      expect(() => SecureFoundationRepoSecrets.parse(result)).not.toThrow();
      expect(result.items).toHaveLength(60);
      expect(result.items[0]?.where).toContain("more jobs");
      expect(result.items[0]?.where).toContain("more workflow files.");
    }
  });

  it("runs one check when two requests arrive together", async () => {
    const { service, asked } = setup();
    const [a, b] = await Promise.all([service.check("p1", here), service.check("p1", here)]);
    expect(a).toBe(b);
    expect(asked).toHaveLength(1);
  });

  it("gives another device the last result read-only, and runs nothing for it", async () => {
    const { service, asked, reads } = setup();
    const away = { local: false, setUp: () => true };
    // Nothing was checked yet: nothing is shown, read or asked.
    expect(await service.view("p1", away)).toMatchObject({ applies: false, items: [] });
    expect(reads()).toBe(0);
    expect(asked).toEqual([]);
    const mine = await service.view("p1", here);
    const theirs = await service.view("p1", away);
    expect(theirs).toEqual({ ...mine, canCheck: false });
    expect(asked).toHaveLength(1);
  });
});
