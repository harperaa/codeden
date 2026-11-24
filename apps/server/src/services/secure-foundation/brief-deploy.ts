import { HARDEN_PRODUCT_NAME, type SecureFoundationDeploy } from "@codeden/contracts";

/** The command file of the template's dev deploy. */
export const DEPLOY_COMMAND_FILE = ".claude/commands/deploy-to-dev.md";

/** The repository secret the template's Claude review workflows read. */
export const CLAUDE_TOKEN_SECRET = "CLAUDE_CODE_OAUTH_TOKEN";

/**
 * What the project's own `/deploy-to-dev` does about the new repository's Actions secrets, read
 * from the command file the setup copied from the template. Later versions of the template add a
 * step, right after the repository exists, that creates the Doppler CI token there (moved out of
 * `/install`) and asks the person for `CLAUDE_CODE_OAUTH_TOKEN`, and create the repository
 * without pushing so that step comes before the first push. Earlier ones have none of it. The
 * brief follows whichever the file is, so `doppler-create-ci-token` runs exactly once. Matched
 * on what the file runs and names, never on its step numbers.
 */
export interface DeployFileShape {
  /** The file runs `doppler-create-ci-token` itself (its secrets step). */
  storesDopplerToken: boolean;
  /** The file has a step for `CLAUDE_CODE_OAUTH_TOKEN` that asks the person. */
  asksClaudeToken: boolean;
  /** The file's `github-setup` passes `--no-push`; a later step makes the first push. */
  noPush: boolean;
  /**
   * The file's `CLAUDE_CODE_OAUTH_TOKEN` question recommends "Skip for now" (later versions of
   * the template): the setup's answer is then the file's own default, not a departure from it.
   */
  skipRecommended: boolean;
}

/** What the file does, from its text; null (no such file) reads as a file without the step. */
export function deployFileShape(text: string | null): DeployFileShape {
  const file = text ?? "";
  return {
    storesDopplerToken: file.includes("doppler-create-ci-token"),
    asksClaudeToken: file.includes(CLAUDE_TOKEN_SECRET),
    noPush: /github-setup[^\n`]*--no-push/.test(file),
    skipRecommended: /Skip for now \(Recommended\)/.test(file),
  };
}

/** What the deploy part needs to know of the setup. */
export interface DeployPartInput {
  doppler: boolean;
  /** The Doppler project the install's bootstrap created (`secureFoundationDopplerProject`). */
  dopplerProject: string;
  /** The provider runs project command files (`capabilities.projectCommands`). */
  runsCommandFiles: boolean;
  /** The line that marks a step where the brief departs from the file, with its reason. */
  differs: string;
  /** What the project's `/deploy-to-dev` does about the repository's secrets. */
  file: DeployFileShape;
}

/**
 * Part 3 of the setup brief: the template's `/deploy-to-dev`, step by step in its order (Step 0
 * to Step 8), with the form's answers in place of its questions. Every place it departs from
 * the file is marked with `differs` and says why; the reasons are also in
 * `docs/secure-foundation.md` ("How the setup follows the template").
 */
export function deployPart(
  input: DeployPartInput,
  deploy: SecureFoundationDeploy,
  failed: string,
): string[] {
  const { differs, file } = input;
  const repo = `${deploy.owner}/${deploy.repository}`;
  const scope = `--scope="${deploy.vercelScope}"`;
  const run = input.runsCommandFiles
    ? `Run this project's \`/deploy-to-dev\` command (the command file \`${DEPLOY_COMMAND_FILE}\`).`
    : `Read \`${DEPLOY_COMMAND_FILE}\` and follow it step by step.`;
  return [
    "## Part 3: the repository and the dev deploy, the template's `/deploy-to-dev` (no questions)",
    `${run} Go through its steps in order. Its questions are answered here: the GitHub account is the one signed in now, the target owner is \`${deploy.owner}\`, the repository is ${repo} (private) and the Vercel scope is \`${deploy.vercelScope}\`.`,
    // Step 0 asks whether to deploy again; a new project has nothing deployed yet.
    `- **Step 0** (existing deployment): \`docs/DEPLOYMENT-DEV.md\` doesn't exist in a new project; go on. ${differs} if it does exist, stop instead of asking whether to deploy again: deploying again wasn't agreed.`,
    [
      "- **Step 1** (prerequisites): `node -v`, `node_modules`, then `node scripts/deploy.mjs check-tools`; stop with the file's message if `gh` is missing or `ghAuth` is false.",
      input.doppler
        ? ` Doppler mode: \`doppler me --json\`, then \`doppler secrets --config dev --only-names\` must list the \`dev\` config's secrets (stop with the file's message if it is empty). ${differs} the file's command also passes \`--project $(node -p "require('./package.json').name")\`, which is still the template's package name, not the Doppler project the install created ("${input.dopplerProject}"); without it the command uses the project \`.doppler.yaml\` pins, as the file's Step 8 says.`
        : ` Legacy mode: check the eight keys the file lists in \`.env.local\` the way it says (present, not empty, no \`your_\` or \`<\`). ${differs} check them with a command that prints only each key's name and whether it passed, never its value (the rule on secrets above).`,
    ].join(""),
    `- **Step 1.5** (GitHub account, workflow scope, owner): run \`node scripts/deploy.mjs gh-context\` again. Its three questions are answered: use the signed-in \`username\` (the person confirmed the account in the form, and Part 1 checked it), \`hasWorkflowScope\` must be true (Part 1 checked it; if it isn't, stop), and \`<OWNER>\` is \`${deploy.owner}\`. Show "Target owner locked: \`${deploy.owner}\`".`,
    `- **Step 2** (GitHub repository): \`node scripts/deploy.mjs github-setup --repo-name="${deploy.repository}" --owner="${deploy.owner}"${file.noPush ? " --no-push" : ""}\`${file.noPush ? " (with the file's `--no-push`: its secrets step comes before the first push)" : ""}. ${differs} the name is the one confirmed in the form, not the folder's basename, and on \`repo_exists\` don't retry with an \`-app\` suffix: stop, because that is a name the person didn't confirm. On \`owner_mismatch\` stop and show its \`hint\`, as the file says.`,
    ...(input.doppler && !file.storesDopplerToken
      ? [
          `  - Then the install's last Doppler post-init step: \`node scripts/setup.mjs doppler-create-ci-token\` (moved here from Part 2: the repository it stores the token in exists now). If it fails because \`gh\` isn't signed in, put the file's fallback under "left for later". When it succeeded, run the install's \`node scripts/setup.mjs write-install-summary\` again with the same arguments as in Part 2 and the file's whole Doppler-mode list of completed steps, so \`docs/INSTALL.md\` records the CI token as the template's install does.`,
        ]
      : []),
    `- **Step 2.5** (verify the owner): \`git remote get-url origin\`; its owner must be \`${deploy.owner}\` (case-insensitive), or stop with the file's message.`,
    ...secretsStep(input, repo),
    `- **Step 3** (\`vercel.json\`): always overwrite it with the file's block for ${input.doppler ? "Doppler mode" : "legacy mode"}, then re-read it and confirm its \`buildCommand\` doesn't contain \`modules.mjs install\`.`,
    file.noPush
      ? '- **Step 4** (commit and push): `git status`; with changes, `git add -A && git commit -m "Prepare for Vercel deployment"`; then always `git push -u origin main`, the repository\'s first push, as the file says.'
      : '- **Step 4** (commit and push): `git status`; with changes, `git add -A && git commit -m "Prepare for Vercel deployment" && git push origin main`, as the file says.',
    `- **Step 5** (Vercel link and git connect): \`<REPO_NAME>\` is the origin's repository name (\`${deploy.repository}\`). \`<SCOPE>\` is \`${deploy.vercelScope}\`, chosen in the form: don't ask which team. Then \`npx vercel project add "${deploy.repository}" ${scope} 2>&1 || true\`, \`npx vercel link --yes --project="${deploy.repository}" ${scope}\`, \`npx vercel git connect "$(git remote get-url origin)" --yes ${scope}\`, and \`npx vercel project inspect "${deploy.repository}" ${scope}\` to confirm it is connected to ${repo}. If the git connect fails, give the file's warning and go on, as it says.`,
    input.doppler
      ? "- **Step 6** (Vercel environment variables): `node scripts/deploy.mjs vercel-env-dev`. In Doppler mode it runs `vercel-env-doppler`: a fresh `dev` service token as `DOPPLER_TOKEN` on all three Vercel targets (development, preview and production), `REVALIDATE_TOKEN` in Doppler if it is missing, and `scripts/sync-convex-env.mjs --config dev`. Expect three `DOPPLER_TOKEN` entries in `varsSet` and no app values. On `production_already_promoted`, stop and never pass `--force-overwrite-prod`. Show any other failure, as the file says."
      : "- **Step 6** (Vercel environment variables): `node scripts/deploy.mjs vercel-env-dev`. In legacy mode it copies the values from `.env.local` to Vercel; show the names it set, never the values. On `production_already_promoted`, stop and never pass `--force-overwrite-prod`. Show any other failure, as the file says.",
    "- **Step 7** (deploy): `node scripts/deploy.mjs vercel-deploy`. Use its `productionUrl` (the short vercel.app address), else its `url`.",
    `- **Step 8** (summary): \`node scripts/deploy.mjs write-summary --deploy-type="dev" …\` with exactly the arguments the file gives, the values gathered the way it says (${input.doppler ? "`doppler secrets get NEXT_PUBLIC_CLERK_FRONTEND_API_URL NEXT_PUBLIC_SITE_NAME --plain` for the two public values Doppler holds" : "`grep` from `.env.local` for the public values it names"}). Its "Dev Deployment Complete!" summary goes into your final message.`,
    `If any of these would act on another repository, owner, project or scope than the ones above, or the file tells you to ask the person${file.asksClaudeToken ? ` (apart from the \`${CLAUDE_TOKEN_SECRET}\` question, answered above)` : ""}, stop, report "${failed}" and say what was already created. ${input.doppler ? "The only repository secret you store is `DOPPLER_TOKEN`, by the template's own step" : "Store no repository secret"}: set no other secret or variable, never ask the person for a value, never run \`claude setup-token\` and never read, test or pass on a \`${CLAUDE_TOKEN_SECRET}\` of this session's environment. The ones this project's workflows use are the person's to add, and ${HARDEN_PRODUCT_NAME} lists them on the project page.`,
    "",
  ];
}

/**
 * The repository's Actions secrets, right after the repository exists. With the file's own
 * secrets step: its `DOPPLER_TOKEN` part as written. Its `CLAUDE_CODE_OAUTH_TOKEN` part: where
 * the file recommends "Skip for now", as written with that answer; in the earlier version that
 * recommended generating the token in the session, replaced by a check of the names, because that part needs the person's own Claude sign-in and
 * would put the token into this session's transcript. Without it: the same check, added, so the
 * final message can say whether the person still has to add the secret.
 */
function secretsStep(input: DeployPartInput, repo: string): string[] {
  const { differs, file } = input;
  const check = `run \`gh secret list --repo ${repo} --json name\` (it lists names only, never a value; read-only) and note whether \`${CLAUDE_TOKEN_SECRET}\` is among them. If the command fails, note that it couldn't be checked. Then go straight on to the next step: nothing waits for this secret`;
  if (!file.asksClaudeToken) {
    return [
      `- **Repository secrets** (added by ${HARDEN_PRODUCT_NAME}, right after the owner is verified): ${check}. Set nothing here. Your final message tells the person how to add it.`,
    ];
  }
  const doppler = !file.storesDopplerToken
    ? ""
    : input.doppler
      ? " Its `DOPPLER_TOKEN` part: as the file says (it runs `node scripts/setup.mjs doppler-create-ci-token` when the secret isn't listed; in Part 2 it was deferred). If that fails, put the file's fallback under \"left for later\" and go on, as it says."
      : " Its `DOPPLER_TOKEN` part: skip it, as the file says when `.doppler.yaml` doesn't exist.";
  const step = `- **The file's GitHub Actions secrets step** (right after the owner is verified, before \`vercel.json\` and the first push; the one that lists the repository's secrets and handles \`DOPPLER_TOKEN\` and \`${CLAUDE_TOKEN_SECRET}\`). Use \`${repo}\` for its \`<GH_REPO>\`.`;
  if (file.skipRecommended) {
    return [
      `${step} Its list of the repository's secrets is read-only and names only: run it as the file says and note whether \`${CLAUDE_TOKEN_SECRET}\` is among them (if the command fails, note that it couldn't be checked).${doppler} Its \`${CLAUDE_TOKEN_SECRET}\` part: if the name is listed, the file's "already set" path. Otherwise its question is answered "Skip for now", the file's recommended choice: the person isn't watching, and the token is made with \`claude setup-token\` in their own terminal. Take the file's "Skip for now" path, so Step 8's summary lists it with the file's next step, and go on. Don't take its other two choices: don't run \`claude setup-token\` or ask the person to, don't push a \`${CLAUDE_TOKEN_SECRET}\` of this session's environment, and don't run \`gh secret set\` for it.`,
    ];
  }
  return [
    `${step}${doppler} Its \`${CLAUDE_TOKEN_SECRET}\` part: ${differs} don't ask the person, don't run \`claude setup-token\` or ask them to, don't test or push a \`${CLAUDE_TOKEN_SECRET}\` of this session's environment, and don't run \`gh secret set\` for it. The token needs the person's own Claude sign-in, they aren't watching, and generating or pasting it here would put it into this session's transcript. Instead ${check}. If it isn't listed, take the file's "Skip for now" path, so Step 8's summary lists it as skipped with the file's next step; if it is listed, the file's "already set" path.`,
  ];
}
