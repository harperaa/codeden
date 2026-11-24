import { execFileSync } from "node:child_process";
import { secureFoundationCreates } from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DIFFERS, type SetupBriefInput, setupBrief } from "../src/services/secure-foundation/brief";
import { removeTree } from "./support/remove-tree";
import { makeTemplateFixture, type TemplateFixture } from "./support/secure-foundation-fixture";

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
  ...over,
});

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
 * (Step 0 to Step 8, with Step 2.6), read from the template at the commit the setup installs.
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
  "**Step 2.6**",
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
      "doppler-create-ci-token",
    ]);
    expect(ran[0]?.installed).toEqual(["blog", "pricing"]);
    expect(ran[1]?.args).toEqual({ "project-name": "My Site" });
    // The file runs the CI token step and expects it to defer while there is no repository;
    // without the deploy there never is one, so it is handed on for later.
    expect(brief).toContain(
      "The project has no GitHub repository yet, so the second answers `deferred: true` and creates nothing, which the file expects",
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
      " don't open the claim URL in a browser a",
      " if it does exist, stop instead of askin",
      " the file's command also passes `--proje",
      " the name is the one confirmed in the fo",
    ]);
    // Each says what is done instead and why, not just that it differs.
    for (const difference of all) expect(difference.length).toBeGreaterThan(80);
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

    it("stores the Doppler token in the deploy's Step 2.6a, once the repository exists", () => {
      const text = deployed({ doppler: true });
      const ran = commands(text)
        .map(run)
        .map((r) => r.command);
      // Deferred in the install, as the file expects; stored right after the repository exists.
      expect(ran.indexOf("doppler-create-ci-token")).toBe(
        ran.indexOf("doppler-sync-env-local") + 1,
      );
      expect(ran.lastIndexOf("doppler-create-ci-token")).toBe(ran.indexOf("github-setup") + 1);
      expect(ran[ran.lastIndexOf("doppler-create-ci-token") + 1]).toBe("vercel-env-dev");
      expect(text).toContain("The deploy's Step 2.6a stores the token once the repository exists.");
      expect(text).toContain("`gh secret list -R acme-org/my-site --json name -q '.[].name'`");
      expect(text).toContain("`DOPPLER_TOKEN` on all three Vercel targets");
      expect(text).toContain("`doppler secrets --config dev --only-names`");
      expect(deployed()).toContain("**2.6a** (`DOPPLER_TOKEN`): not in this mode");
    });

    it("answers the Claude token question of Step 2.6b with the file's default, Skip for now", () => {
      for (const text of [deployed(), deployed({ doppler: true })]) {
        expect(text).toContain(
          'its question is answered "Skip for now", the file\'s recommended choice',
        );
        expect(text).toContain("never run `claude setup-token`, and never store this secret");
        expect(text).toContain('(the file\'s "Push my existing token")');
        expect(text).not.toContain("! claude");
        expect(text).toContain("something this brief doesn't answer, stop");
      }
    });

    it("leaves the repository secrets the workflows use to the person, and says where they are listed", () => {
      const withDoppler = deployed({ doppler: true });
      expect(withDoppler).toContain(
        "The only repository secret you store is `DOPPLER_TOKEN`, by the template's own Step 2.6a",
      );
      expect(withDoppler).toContain("never ask the person for a value");
      expect(deployed()).toContain("Store no repository secret: set no other secret or variable");
      for (const text of [deployed(), withDoppler]) {
        expect(text).toContain(
          "so they need the repository secret `CLAUDE_CODE_OAUTH_TOKEN`: a token for your own Claude subscription.",
        );
        expect(text).toContain("The template's deploy skips it by default, and so did this setup");
        expect(text).toContain(
          "open a regular terminal window (not a Claude Code session, which would keep the token in its transcript), run `claude setup-token`",
        );
        expect(text).toContain("`gh secret set CLAUDE_CODE_OAUTH_TOKEN -R acme-org/my-site`");
        expect(text).toContain(
          "the template's Claude review jobs are skipped on every pull request: a skipped review means no review ran",
        );
        expect(text).toMatch(/Reviews you run inside \S+ use your own subscription/);
        expect(text).toContain(
          "the project page's Secure Foundation setup card lists every one acme-org/my-site doesn't have, with the steps for each.",
        );
      }
      // A project that stays local has no repository to hold a secret: nothing is said of it.
      expect(setupBrief(input())).not.toContain("repository secret");
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
      'put this in `--manual-steps` and under "left for later": "Run node scripts/setup.mjs doppler-create-ci-token once the project has a GitHub repository"',
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
