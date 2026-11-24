import { execFileSync } from "node:child_process";
import { secureFoundationCreates } from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DIFFERS,
  deployFileShape,
  type SetupBriefInput,
  setupBrief,
} from "../src/services/secure-foundation/brief";
import { removeTree } from "./support/remove-tree";
import {
  DEPLOY_FILE_SKIP_RECOMMENDED,
  DEPLOY_FILE_WITH_SECRETS_STEP,
  DEPLOY_FILE_WITHOUT_SECRETS_STEP,
  makeTemplateFixture,
  type TemplateFixture,
} from "./support/secure-foundation-fixture";

/**
 * The setup session's brief: its two forms, and that the commands it spells out are ones the
 * install's scripts take (run against the fixture's scripts, which refuse any other flag).
 */
const input = (over: Partial<SetupBriefInput> = {}): SetupBriefInput => ({
  name: "My Site",
  adminEmail: "person@site.test",
  doppler: false,
  modules: [],
  skippedModules: ["blog", "pricing"],
  repository: "fixture/template",
  commit: "0123456789abcdef0123456789abcdef01234567",
  runsCommandFiles: true,
  convexTeam: null,
  deploy: null,
  creates: secureFoundationCreates({ name: "My Site", secrets: "env_local" }),
  deployFile: deployFileShape(DEPLOY_FILE_WITHOUT_SECRETS_STEP),
  ...over,
});

/** The template's `/deploy-to-dev` with its own step for the repository's Actions secrets. */
const withSecretsStep = { deployFile: deployFileShape(DEPLOY_FILE_WITH_SECRETS_STEP) };
const skipRecommended = { deployFile: deployFileShape(DEPLOY_FILE_SKIP_RECOMMENDED) };

/** Split a command line on spaces outside double quotes, dropping the quotes. */
const words = (line: string) =>
  (line.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((w) => w.replaceAll('"', ""));

/** The `node scripts/…` commands the brief gives in full. */
const commands = (brief: string) =>
  [...brief.matchAll(/`(node scripts\/[^`]+)`/g)]
    .map((m) => m[1] as string)
    .filter((c) => !c.includes("…") && !c.includes("<"));

let fixture: TemplateFixture;
beforeAll(() => {
  fixture = makeTemplateFixture();
});
afterAll(() => removeTree(fixture.root));

const run = (command: string) => {
  const [, ...args] = words(command);
  return JSON.parse(
    execFileSync(process.execPath, args, { cwd: fixture.source.url, encoding: "utf8" }),
  ) as { command?: string; args?: Record<string, string>; installed?: string[] };
};

/**
 * The steps of the template's two commands, in their order, as the brief names them: the
 * sections of `.claude/commands/install.md` (Phase 1 to Phase 6, with the module install and
 * the Doppler bootstrap and post-init between them) and of `.claude/commands/deploy-to-dev.md`
 * (Step 0 to Step 8), read from the template at the commit the setup installs.
 */
const INSTALL_STEPS = [
  "**Phase 1**",
  "**Phase 2**",
  "**Install content modules**",
  "**Doppler bootstrap**",
  "**Phase 3**",
  "**Phase 4**",
  "**Phase 5**",
  "**Doppler post-init**",
  "**Phase 6, Step 1**",
  "**Phase 6, Step 2**",
  "**Phase 6, Step 3**",
];
const DEPLOY_STEPS = [
  "**Step 0**",
  "**Step 1**",
  "**Step 1.5**",
  "**Step 2**",
  "**Step 2.5**",
  "**Step 3**",
  "**Step 4**",
  "**Step 5**",
  "**Step 6**",
  "**Step 7**",
  "**Step 8**",
];

/** Where each of `steps` is in `text`; every one must be there, once. */
const positions = (text: string, steps: string[]) =>
  steps.map((step) => {
    const at = text.indexOf(step);
    expect(at, step).toBeGreaterThan(-1);
    expect(text.indexOf(step, at + 1), `${step} twice`).toBe(-1);
    return at;
  });

/**
 * The text after each "Differs from the file:" marker, up to the end of its line (the rules
 * name the marker in quotes; that one is no difference).
 */
const differences = (text: string) =>
  text
    .split(DIFFERS)
    .slice(1)
    .filter((rest) => !rest.startsWith('"'))
    .map((rest) => rest.split("\n")[0] as string);

const deploy = {
  owner: "acme-org",
  repository: "my-site",
  visibility: "private" as const,
  vercelScope: "acme-team",
};
const deployed = (over: Partial<SetupBriefInput> = {}) =>
  setupBrief(
    input({
      deploy,
      creates: secureFoundationCreates({
        name: "My Site",
        secrets: over.doppler ? "doppler" : "env_local",
        deploy,
      }),
      ...over,
    }),
  );

describe("the setup brief", () => {
  it("runs /install where the provider runs command files, and reads the file where it doesn't", () => {
    const runs = setupBrief(input());
    const reads = setupBrief(input({ runsCommandFiles: false }));
    expect(runs).toContain("Run this project's `/install` command");
    expect(runs).not.toContain("follow it step by step");
    expect(reads).toContain("Read `.claude/commands/install.md` and follow it step by step.");
    expect(reads).not.toContain("Run this project's `/install` command");
  });

  it("walks the install's phases in the template's order, skipping none", () => {
    for (const brief of [setupBrief(input()), setupBrief(input({ doppler: true }))]) {
      const at = positions(brief, INSTALL_STEPS);
      expect(at).toEqual([...at].sort((a, b) => a - b));
      expect(brief).toContain("Don't skip a step, don't move one and don't replace one");
    }
  });

  it("passes the form's answers as the flags the install's scripts take", () => {
    const outputs = commands(setupBrief(input())).map(run);
    expect(outputs).toEqual([
      {
        success: true,
        command: "init",
        args: { "site-name": "My Site", "admin-email": "person@site.test" },
      },
      { success: true, command: "convex-setup", args: { "project-name": "My Site" } },
      { success: true, command: "configure", args: { "admin-email": "person@site.test" } },
    ]);
  });

  it("runs the modules and the Doppler steps in the file's order, and leaves the CI token for later without a repository", () => {
    const brief = setupBrief(
      input({
        doppler: true,
        modules: ["blog", "pricing"],
        skippedModules: [],
        creates: secureFoundationCreates({ name: "My Site", secrets: "doppler" }),
      }),
    );
    const ran = commands(brief).map(run);
    expect(ran.map((r) => r.command ?? "modules")).toEqual([
      "modules",
      "doppler-bootstrap",
      "init",
      "convex-setup",
      "configure",
      "doppler-sync-env-local",
    ]);
    expect(ran[0]?.installed).toEqual(["blog", "pricing"]);
    expect(ran[1]?.args).toEqual({ "project-name": "My Site" });
    // The step is named, marked as a difference with its reason, and handed on as the file's fallback.
    expect(brief).toContain(
      `${DIFFERS} don't run its second command, \`doppler-create-ci-token\`: it stores the token as a secret of the project's GitHub repository, and this project has none`,
    );
    expect(brief).toContain(
      '"Run node scripts/setup.mjs doppler-create-ci-token once the project has a GitHub repository"',
    );
    expect(brief).toContain("`npm run convex:doppler` and `npm run dev:doppler`");
    expect(brief).toContain('Doppler: a Doppler project named "my-site"');
  });

  it("uses the template's own Convex sign-in command and its questions", () => {
    const brief = setupBrief(input());
    expect(brief).toContain(
      '`npx convex login --login-flow poll --no-open --device-name "claude-setup"`',
    );
    expect(brief).toContain("\"Convex login didn't complete. Would you like to try again");
    expect(brief).toContain('"Which Convex team should this project be created under?"');
  });

  it("passes the Convex team chosen in the form", () => {
    const brief = setupBrief(input({ convexTeam: "acme-labs" }));
    const convex = commands(brief)
      .map(run)
      .find((r) => r.command === "convex-setup");
    expect(convex?.args).toEqual({ "project-name": "My Site", team: "acme-labs" });
    expect(brief).toContain("the person chose the team `acme-labs`");
  });

  it("marks every place it departs from the template, each with its reason, and no others", () => {
    // A project that stays local: the sign-ins first, the questions answered by the form, no browser for the claim.
    expect(differences(setupBrief(input())).map((d) => d.slice(0, 40))).toEqual([
      " the template's steps start their sign-i",
      " the file says to ask its four questions",
      " don't open the claim URL in a browser a",
    ]);
    // Everything: Doppler and the deploy.
    const all = differences(deployed({ doppler: true }));
    expect(all.map((d) => d.slice(0, 40))).toEqual([
      " the template's steps start their sign-i",
      " the bootstrap would install a missing C",
      " the file has you run these two yourself",
      " the file says to ask its four questions",
      " don't run its second command, `doppler-",
      " don't open the claim URL in a browser a",
      " if it does exist, stop instead of askin",
      " the file's command also passes `--proje",
      " the name is the one confirmed in the fo",
    ]);
    // Each says what is done instead and why, not just that it differs.
    for (const difference of all) expect(difference.length).toBeGreaterThan(80);
    // A template whose deploy has the secrets step: the install's CI token step runs as written
    // (it defers), and the Claude token question, which recommends generating the token in the
    // session, is a difference.
    const withoutInstallDifference = all
      .map((d) => d.slice(0, 40))
      .filter((d) => d !== " don't run its second command, `doppler-");
    const newer = differences(deployed({ doppler: true, ...withSecretsStep }));
    expect(newer.map((d) => d.slice(0, 40))).toEqual([
      ...withoutInstallDifference,
      " don't ask the person, don't run `claude",
    ]);
    // The later template recommends "Skip for now": that answer is the file's own, no difference.
    const latest = differences(deployed({ doppler: true, ...skipRecommended }));
    expect(latest.map((d) => d.slice(0, 40))).toEqual(withoutInstallDifference);
    // Without Doppler the deploy's Step 1 differs only in printing no value.
    expect(
      differences(deployed()).find(
        (d) => d.includes("eight keys") || d.includes("each key's name"),
      ),
    ).toContain("never its value");
  });

  describe("with the deploy option", () => {
    it("walks the deploy's steps in the template's order, after the install", () => {
      for (const text of [deployed(), deployed({ doppler: true })]) {
        const install = positions(text, INSTALL_STEPS);
        const steps = positions(text, DEPLOY_STEPS);
        expect(steps).toEqual([...steps].sort((a, b) => a - b));
        expect(steps[0]).toBeGreaterThan(install[install.length - 1] as number);
        expect(text).toContain("## Part 4: start the app");
      }
    });

    it("gives the session exactly the confirmed owner, repository and scope", () => {
      const text = deployed();
      const ran = commands(text).map(run);
      expect(ran.find((r) => r.command === "github-setup")?.args).toEqual({
        "repo-name": "my-site",
        owner: "acme-org",
      });
      expect(ran.map((r) => r.command)).toEqual([
        "gh-context",
        "init",
        "convex-setup",
        "configure",
        "check-tools",
        "gh-context",
        "github-setup",
        "vercel-env-dev",
        "vercel-deploy",
      ]);
      expect(text).toContain('npx vercel project add "my-site" --scope="acme-team" 2>&1 || true');
      expect(text).toContain(
        'npx vercel git connect "$(git remote get-url origin)" --yes --scope="acme-team"',
      );
      expect(text).toContain(
        'git add -A && git commit -m "Prepare for Vercel deployment" && git push origin main',
      );
      expect(text).toContain("GitHub: a private repository acme-org/my-site");
      expect(text).toContain("Run this project's `/deploy-to-dev` command");
    });

    it("refuses an existing repository or project, a public one and production", () => {
      const text = deployed();
      expect(text).toContain('`gh repo view "acme-org/my-site"` has to fail');
      expect(text).toContain("don't pick one yourself and don't push into it");
      expect(text).toContain("don't deploy into it");
      expect(text).toContain("on `repo_exists` don't retry with an `-app` suffix: stop");
      expect(text).toContain("On `owner_mismatch` stop");
      expect(text).toContain("Never run `/deploy-to-prod`");
      expect(text).toContain("never make the repository public");
      expect(text).toContain("On `production_already_promoted`, stop");
      expect(text).toContain("a public repository, a production deploy");
      expect(text).not.toContain("Don't create a GitHub repository");
    });

    it("hands the GitHub sign-in commands of the file to the person", () => {
      const text = deployed();
      expect(text).toContain("`gh auth login -h github.com -s workflow,repo,read:org`");
      expect(text).toContain("`gh auth refresh -h github.com -s workflow`");
      expect(text).toContain("so the person runs them in their own terminal");
    });

    it("stores the Doppler token right after the repository exists, and records it in the install summary", () => {
      const text = deployed({ doppler: true });
      const ran = commands(text)
        .map(run)
        .map((r) => r.command);
      expect(ran.indexOf("doppler-create-ci-token")).toBe(ran.indexOf("github-setup") + 1);
      expect(ran[ran.indexOf("doppler-create-ci-token") + 1]).toBe("write-install-summary");
      expect(text).toContain("`DOPPLER_TOKEN` on all three Vercel targets");
      expect(text).toContain("`doppler secrets --config dev --only-names`");
      expect(commands(setupBrief(input({ doppler: true }))).join()).not.toContain("ci-token");
    });

    it("leaves the repository secrets the workflows use to the person, and says where they are listed", () => {
      const withDoppler = deployed({ doppler: true });
      expect(withDoppler).toContain(
        "The only repository secret you store is `DOPPLER_TOKEN`, by the template's own step",
      );
      expect(withDoppler).toContain("never ask the person for a value");
      expect(deployed()).toContain("Store no repository secret: set no other secret or variable");
      for (const text of [
        deployed(),
        withDoppler,
        deployed(withSecretsStep),
        deployed({ doppler: true, ...withSecretsStep }),
      ]) {
        expect(text).toContain(
          "so they need the repository secret `CLAUDE_CODE_OAUTH_TOKEN`: a token for your own Claude subscription. This setup didn't add it: creating it needs your own Claude sign-in, and the token would have passed through this session's transcript.",
        );
        expect(text).toContain(
          "1. Run `claude setup-token`, approve the sign-in in your browser and copy the token it prints (valid for one year; it is saved nowhere).",
        );
        expect(text).toContain(
          "2. Run `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo acme-org/my-site` and paste the token when it asks (it isn't shown as you type).",
        );
        expect(text).toContain("https://github.com/apps/claude");
        expect(text).toContain(
          "choose as its owner a GitHub organisation that already shares `CLAUDE_CODE_OAUTH_TOKEN` with its repositories. If acme-org is one, there is nothing to do",
        );
        expect(text).toContain(
          '"`CLAUDE_CODE_OAUTH_TOKEN` is already set in acme-org/my-site: the template\'s Claude reviews can run."',
        );
        expect(text).toMatch(/Reviews you run inside \S+ use your own subscription/);
        expect(text).toContain(
          "the project page's Secure Foundation setup card lists every one acme-org/my-site doesn't have, with the steps for each.",
        );
        // The session only reads the names, never sets the token, and goes on.
        expect(text).toContain(
          "run `gh secret list --repo acme-org/my-site --json name` (it lists names only, never a value; read-only)",
        );
        expect(text).toContain(
          "Then go straight on to the next step: nothing waits for this secret",
        );
        expect(text).toContain("never run `claude setup-token`");
        expect(text).not.toMatch(/sk-ant|printf|\$CLAUDE_CODE_OAUTH_TOKEN|<<|`!/);
        // One command that sets a secret: the person's own step in the final message.
        expect(text.match(/`gh secret set [^`]+`/g)).toEqual([
          "`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo acme-org/my-site`",
        ]);
      }
      // A project that stays local has no repository to hold a secret: nothing is said of it.
      expect(setupBrief(input())).not.toContain("repository secret");
      expect(setupBrief(input(withSecretsStep))).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    });

    it("checks the Claude token right after the owner is verified, without the template's step and with it", () => {
      const before = deployed();
      expect(before).toContain(
        "- **Repository secrets** (added by CodeHarden, right after the owner is verified): run `gh secret list",
      );
      expect(before).not.toContain("The file's GitHub Actions secrets step");
      const after = deployed(withSecretsStep);
      expect(after).toContain(
        "- **The file's GitHub Actions secrets step** (right after the owner",
      );
      expect(after).toContain(
        `Its \`CLAUDE_CODE_OAUTH_TOKEN\` part: ${DIFFERS} don't ask the person, don't run \`claude setup-token\``,
      );
      expect(after).toContain(
        "generating or pasting it here would put it into this session's transcript",
      );
      expect(after).toContain('take the file\'s "Skip for now" path');
      expect(after).toContain(
        "(apart from the `CLAUDE_CODE_OAUTH_TOKEN` question, answered above)",
      );
      expect(before).not.toContain("question, answered above");
      for (const text of [before, after]) {
        const at = positions(text, ["**Step 2.5**", "gh secret list --repo", "**Step 3**"]);
        expect(at).toEqual([...at].sort((a, b) => a - b));
      }
    });

    it("answers the Claude token question with the file's own recommended Skip for now, where it has one", () => {
      for (const doppler of [false, true]) {
        const text = deployed({ doppler, ...skipRecommended });
        expect(text).toContain(
          "Its list of the repository's secrets is read-only and names only: run it as the file says",
        );
        expect(text).toContain(
          'Otherwise its question is answered "Skip for now", the file\'s recommended choice',
        );
        expect(text).toContain('Take the file\'s "Skip for now" path');
        expect(text).toContain(
          "Don't take its other two choices: don't run `claude setup-token` or ask the person to",
        );
        expect(text).not.toContain(`Its \`CLAUDE_CODE_OAUTH_TOKEN\` part: ${DIFFERS}`);
        expect(text).toContain(
          "(apart from the `CLAUDE_CODE_OAUTH_TOKEN` question, answered above)",
        );
        expect(text).toContain("never run `claude setup-token`");
        expect(text).not.toMatch(/sk-ant|printf|\$CLAUDE_CODE_OAUTH_TOKEN|<<|`!/);
        // One command that sets a secret: the person's own step in the final message.
        expect(text.match(/`gh secret set [^`]+`/g)).toEqual([
          "`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo acme-org/my-site`",
        ]);
        const at = positions(text, [
          "**Step 2.5**",
          "The file's GitHub Actions secrets step",
          "**Step 3**",
        ]);
        expect(at).toEqual([...at].sort((a, b) => a - b));
      }
    });

    it("follows the deploy file's version: it creates the Doppler token exactly once and pushes when the file does", () => {
      const ciToken = (text: string) =>
        commands(text)
          .map(run)
          .filter((r) => r.command === "doppler-create-ci-token").length;
      const before = deployed({ doppler: true });
      const after = deployed({ doppler: true, ...withSecretsStep });
      expect(ciToken(before)).toBe(1);
      // After: the install runs it as its file says, and that version defers without a
      // repository (creates nothing); the deploy's secrets step is the one that creates it.
      expect(ciToken(after)).toBe(2);
      expect(after).toContain(
        "This version of the template defers it while the project has no GitHub repository: it answers `deferred: true` and creates nothing",
      );
      expect(after).toContain("If it answers anything else, stop");
      expect(after).toContain("drop its last one, the CI service token, since it was deferred");
      expect(before).not.toContain("deferred: true");
      // Before: the brief runs it right after the repository exists and records it in the install summary.
      expect(before).toContain("moved here from Part 2");
      expect(after).not.toContain("moved here from Part 2");
      expect(after).not.toContain("`node scripts/setup.mjs write-install-summary` again");
      // After: the file's own secrets step creates it.
      expect(after).toContain(
        "Its `DOPPLER_TOKEN` part: as the file says (it runs `node scripts/setup.mjs doppler-create-ci-token` when the secret isn't listed; in Part 2 it was deferred)",
      );
      expect(after).toContain(
        "The deploy's own secrets step stores the token once the repository exists.",
      );
      expect(deployed(withSecretsStep)).toContain(
        "Its `DOPPLER_TOKEN` part: skip it, as the file says when `.doppler.yaml` doesn't exist.",
      );
      expect(commands(deployed(withSecretsStep)).join()).not.toContain("ci-token");
      // Without a deploy, a deferring template still runs it in the install, and it is left for later.
      const local = setupBrief(input({ doppler: true, ...withSecretsStep }));
      expect(commands(local).map((c) => run(c).command)).toContain("doppler-create-ci-token");
      expect(local).toContain(
        '"Run node scripts/setup.mjs doppler-create-ci-token once the project has a GitHub repository"',
      );
      // The repository is created without a push where the file says so, and pushed in Step 4.
      const setup = (text: string) =>
        commands(text)
          .map(run)
          .find((r) => r.command === "github-setup")?.args;
      expect(setup(after)).toEqual({
        "repo-name": "my-site",
        owner: "acme-org",
        "no-push": "true",
      });
      expect(setup(before)).toEqual({ "repo-name": "my-site", owner: "acme-org" });
      expect(after).toContain("then always `git push -u origin main`, the repository's first push");
    });

    it("reads the deploy file's version from what it runs, not from its step numbers", () => {
      expect(deployFileShape(DEPLOY_FILE_WITHOUT_SECRETS_STEP)).toEqual({
        storesDopplerToken: false,
        asksClaudeToken: false,
        noPush: false,
        skipRecommended: false,
      });
      expect(deployFileShape(DEPLOY_FILE_WITH_SECRETS_STEP)).toEqual({
        storesDopplerToken: true,
        asksClaudeToken: true,
        noPush: true,
        skipRecommended: false,
      });
      expect(deployFileShape(DEPLOY_FILE_SKIP_RECOMMENDED)).toEqual({
        storesDopplerToken: true,
        asksClaudeToken: true,
        noPush: true,
        skipRecommended: true,
      });
      expect(deployFileShape(DEPLOY_FILE_WITH_SECRETS_STEP.replaceAll("2.6", "3.1"))).toEqual(
        deployFileShape(DEPLOY_FILE_WITH_SECRETS_STEP),
      );
      expect(deployFileShape(null)).toEqual(deployFileShape(DEPLOY_FILE_WITHOUT_SECRETS_STEP));
    });

    it("reads the deploy file where the provider doesn't run command files", () => {
      expect(deployed({ runsCommandFiles: false })).toContain(
        "Read `.claude/commands/deploy-to-dev.md` and follow it step by step.",
      );
    });
  });

  it("ends with the template's own summaries, then what was created and where each item is removed", () => {
    const brief = setupBrief(
      input({
        doppler: true,
        creates: secureFoundationCreates({ name: "My Site", secrets: "doppler" }),
      }),
    );
    expect(brief).toContain(
      "the install's final summary as the file's Phase 6, Step 2 gives it (\"Installation Complete!\"",
    );
    expect(deployed()).toContain(
      'Then the deploy\'s summary as its Step 8 gives it ("Dev Deployment Complete!")',
    );
    for (const created of secureFoundationCreates({ name: "My Site", secrets: "doppler" })) {
      expect(brief).toContain(
        `- ${created.service}: ${created.item}. Removed in: ${created.removeAt}.`,
      );
    }
    // What configure couldn't finish reaches the summary and the last message.
    expect(brief).toContain(
      "If its `manualSteps` isn't empty, keep them for the summary's `--manual-steps` and your final message.",
    );
    expect(brief).toContain(
      "Then anything left for later, the configure step's `manualSteps` included.",
    );
    // Without a repository, the CI token step goes to both as the template's own fallback.
    expect(brief).toContain(
      'Put the file\'s own fallback in `--manual-steps` and under "left for later": "Run node scripts/setup.mjs doppler-create-ci-token once the project has a GitHub repository"',
    );
    expect(brief).toContain('under the heading "What was created"');
    expect(brief).toContain("removes none of them");
  });

  it("holds the session to the project folder, to the confirmed list and to its secrets", () => {
    const brief = setupBrief(input());
    expect(brief).toContain("Work only inside this project folder.");
    expect(brief).toContain("Never print, quote or summarise a secret");
    expect(brief).toContain("stop and ask the person first");
    expect(brief).toContain("Don't create a GitHub repository, add a git remote, push or deploy.");
    expect(brief).toContain("don't assume port 3000");
    expect(brief).toContain("the URL only works while those processes run");
    expect(brief).not.toContain("Doppler:");
    // No key flag is ever spelled with a value.
    expect(brief).not.toMatch(/--clerk-(?:pk|sk)=/);
  });
});
