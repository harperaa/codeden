import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TemplateSource } from "../../src/services/secure-foundation/template";

/**
 * A tiny local repository standing in for the Secure Foundation template: a fake
 * `.claude/commands/install.md`, two content modules and scripts that only print what they were
 * given. The scripts take the same subcommands and flags as the real template's and exit 2 on
 * anything else, so the brief's commands can be run against them.
 */

const SETUP = `const FLAGS = {
  init: ["site-name", "admin-email"],
  "convex-setup": ["project-name", "team"],
  configure: ["admin-email"],
  "doppler-bootstrap": ["project-name"],
  "doppler-sync-env-local": [],
  "doppler-create-ci-token": [],
  "write-install-summary": ["claim-url", "accountless", "completed-steps", "manual-steps", "modules-installed", "modules-skipped"],
};
const [command, ...rest] = process.argv.slice(2);
const allowed = FLAGS[command];
if (!allowed) { console.error("unknown command " + command); process.exit(2); }
const args = {};
for (const arg of rest) {
  const match = /^--([a-z-]+)=(.*)$/.exec(arg);
  if (!match || !allowed.includes(match[1])) { console.error("unknown flag " + arg); process.exit(2); }
  args[match[1]] = match[2];
}
console.log(JSON.stringify({ success: true, command, args }));
`;

const DEPLOY = `const FLAGS = {
  "check-tools": [],
  "gh-context": [],
  "github-setup": ["repo-name", "owner", "no-push"],
  "vercel-env-dev": [],
  "vercel-deploy": [],
  "write-summary": ["deploy-type", "vercel-url", "dashboard-url", "repo-url", "convex-prod-url", "convex-site-url", "frontend-api-url", "site-name", "admin-email", "google-oauth", "webhook-url", "completed-steps", "skipped-steps"],
};
const [command, ...rest] = process.argv.slice(2);
const allowed = FLAGS[command];
if (!allowed) { console.error("unknown command " + command); process.exit(2); }
const args = {};
for (const arg of rest) {
  const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
  if (!match || !allowed.includes(match[1])) { console.error("unknown flag " + arg); process.exit(2); }
  args[match[1]] = match[2] ?? "true";
}
console.log(JSON.stringify({ success: true, command, args }));
`;

/**
 * The template's `.claude/commands/deploy-to-dev.md` in its two versions, as far as the brief
 * reads it: before the step that sets the new repository's Actions secrets, and with it (it then
 * runs `doppler-create-ci-token` itself, asks for `CLAUDE_CODE_OAUTH_TOKEN`, and creates the
 * repository with `--no-push`, pushing later).
 */
export const DEPLOY_FILE_WITHOUT_SECRETS_STEP =
  '---\ndescription: Fake dev deploy\n---\n\n# /deploy-to-dev\n\n## Step 2: GitHub\n\n- Run: `node scripts/deploy.mjs github-setup --repo-name="<BASENAME>" --owner="<OWNER>"`\n\n## Step 4: Commit and push\n\n- Run: `git add -A && git commit -m "Prepare for Vercel deployment" && git push origin main`\n';
export const DEPLOY_FILE_WITH_SECRETS_STEP =
  '---\ndescription: Fake dev deploy\n---\n\n# /deploy-to-dev\n\n## Step 2: GitHub\n\n- Run: `node scripts/deploy.mjs github-setup --repo-name="<BASENAME>" --owner="<OWNER>" --no-push`\n\n## Step 2.6: GitHub Actions secrets (DOPPLER_TOKEN, CLAUDE_CODE_OAUTH_TOKEN)\n\n`gh secret list -R <GH_REPO> --json name -q \'.[].name\'`\n\n### 2.6a: DOPPLER_TOKEN\n\n- Otherwise run `node scripts/setup.mjs doppler-create-ci-token`.\n\n### 2.6b: CLAUDE_CODE_OAUTH_TOKEN\n\nAsk: generate one with `! claude setup-token`, push an existing one, or skip.\n\n## Step 4: Commit and push\n\n- Run: `git push -u origin main`\n';

const MODULES = `import { existsSync } from "node:fs";
const [command, ...rest] = process.argv.slice(2);
const names = rest.filter((a) => !a.startsWith("--"));
const flags = rest.filter((a) => a.startsWith("--"));
if (command !== "install" || flags.join() !== "--apply-edits" || names.length === 0) process.exit(2);
for (const name of names) if (!existsSync("templates/modules/" + name + "/module.json")) process.exit(2);
console.log(JSON.stringify({ success: true, installed: names }));
`;

const FILES: Record<string, string> = {
  "README.md": "# Fixture template\n",
  ".gitignore": "node_modules\n.env.local\n",
  ".claude/commands/install.md":
    "---\ndescription: Fake install\n---\n\n# /install\n\nRun the setup script.\n",
  ".claude/commands/deploy-to-dev.md": DEPLOY_FILE_WITHOUT_SECRETS_STEP,
  "package.json": `${JSON.stringify({ name: "fixture-template", private: true, scripts: { dev: "echo dev", convex: "echo convex" } }, null, 2)}\n`,
  "scripts/setup.mjs": SETUP,
  "scripts/modules.mjs": MODULES,
  "scripts/deploy.mjs": DEPLOY,
  "templates/modules/blog/module.json": `${JSON.stringify({ name: "blog", title: "Blog", description: "A blog" })}\n`,
  "templates/modules/pricing/module.json": `${JSON.stringify({ name: "pricing", title: "Pricing", description: "A pricing page" })}\n`,
  "templates/modules/Not A Module/module.json": "{}\n",
};

export interface TemplateFixture {
  /** The folder holding the fixture (remove it in teardown). */
  root: string;
  source: TemplateSource;
  /** The commit `main` points at. */
  head(): string;
  /** Add a commit to `main` (the template "moving"); returns the new commit. */
  advance(): string;
}

export function makeTemplateFixture(): TemplateFixture {
  const root = mkdtempSync(join(tmpdir(), "sf-fixture-"));
  const repo = join(root, "template");
  mkdirSync(repo);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        repo,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@site.test",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { stdio: "pipe", encoding: "utf8" },
    );
  git("init", "-q", "-b", "main");
  for (const [path, contents] of Object.entries(FILES)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), contents);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  writeFileSync(join(repo, "README.md"), "# Fixture template\n\nSecond commit.\n");
  git("commit", "-q", "-am", "second");
  let n = 0;
  return {
    root,
    source: { repository: "fixture/template", branch: "main", url: repo },
    head: () => git("rev-parse", "HEAD").trim(),
    advance() {
      writeFileSync(join(repo, "CHANGES.md"), `change ${++n}\n`);
      git("add", "-A");
      git("commit", "-q", "-m", `change ${n}`);
      return git("rev-parse", "HEAD").trim();
    },
  };
}
