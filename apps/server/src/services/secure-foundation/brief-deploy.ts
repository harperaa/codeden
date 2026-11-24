import { HARDEN_PRODUCT_NAME, type SecureFoundationDeploy } from "@codeden/contracts";

/** The command file of the template's dev deploy. */
export const DEPLOY_COMMAND_FILE = ".claude/commands/deploy-to-dev.md";

/** What the deploy part needs to know of the setup. */
export interface DeployPartInput {
  doppler: boolean;
  /** The Doppler project the install's bootstrap created (`secureFoundationDopplerProject`). */
  dopplerProject: string;
  /** The provider runs project command files (`capabilities.projectCommands`). */
  runsCommandFiles: boolean;
  /** The line that marks a step where the brief departs from the file, with its reason. */
  differs: string;
}

/**
 * Part 3 of the setup brief: the template's `/deploy-to-dev`, step by step in its order (Step 0
 * to Step 8, with Step 2.6), with the form's answers in place of its questions. Every place it departs from
 * the file is marked with `differs` and says why; the reasons are also in
 * `docs/secure-foundation.md` ("How the setup follows the template").
 */
export function deployPart(
  input: DeployPartInput,
  deploy: SecureFoundationDeploy,
  failed: string,
): string[] {
  const { differs } = input;
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
    `- **Step 2** (GitHub repository): \`node scripts/deploy.mjs github-setup --repo-name="${deploy.repository}" --owner="${deploy.owner}"\`. ${differs} the name is the one confirmed in the form, not the folder's basename, and on \`repo_exists\` don't retry with an \`-app\` suffix: stop, because that is a name the person didn't confirm. On \`owner_mismatch\` stop and show its \`hint\`, as the file says.`,
    `- **Step 2.5** (verify the owner): \`git remote get-url origin\`; its owner must be \`${deploy.owner}\` (case-insensitive), or stop with the file's message.`,
    `- **Step 2.6** (GitHub Actions secrets): \`<GH_REPO>\` is ${repo}. List the names once, as the file says: \`gh secret list -R ${repo} --json name -q '.[].name'\`.`,
    input.doppler
      ? '  - **2.6a** (`DOPPLER_TOKEN`): as the file says: if it is listed, go on; otherwise `node scripts/setup.mjs doppler-create-ci-token`, which stores the read-only `dev` token in the repository now that it exists. If that fails or still answers `deferred: true`, put the file\'s fallback under "left for later" and go on: the file never blocks the deploy on it.'
      : "  - **2.6a** (`DOPPLER_TOKEN`): not in this mode (there is no `.doppler.yaml`), as the file says.",
    `  - **2.6b** (\`CLAUDE_CODE_OAUTH_TOKEN\`): its question is answered "Skip for now", the file's recommended choice. The token is made with \`claude setup-token\` in the person's own terminal, outside any agent session, and they aren't watching. So don't ask, never run \`claude setup-token\`, and never store this secret, not even from a \`CLAUDE_CODE_OAUTH_TOKEN\` in the environment (the file's "Push my existing token"). Do what the file says for "Skip for now": its line goes under Next Steps in Step 8.`,
    `- **Step 3** (\`vercel.json\`): always overwrite it with the file's block for ${input.doppler ? "Doppler mode" : "legacy mode"}, then re-read it and confirm its \`buildCommand\` doesn't contain \`modules.mjs install\`.`,
    '- **Step 4** (commit and push): `git status`; with changes, `git add -A && git commit -m "Prepare for Vercel deployment" && git push origin main`, as the file says.',
    `- **Step 5** (Vercel link and git connect): \`<REPO_NAME>\` is the origin's repository name (\`${deploy.repository}\`). \`<SCOPE>\` is \`${deploy.vercelScope}\`, chosen in the form: don't ask which team. Then \`npx vercel project add "${deploy.repository}" ${scope} 2>&1 || true\`, \`npx vercel link --yes --project="${deploy.repository}" ${scope}\`, \`npx vercel git connect "$(git remote get-url origin)" --yes ${scope}\`, and \`npx vercel project inspect "${deploy.repository}" ${scope}\` to confirm it is connected to ${repo}. If the git connect fails, give the file's warning and go on, as it says.`,
    input.doppler
      ? "- **Step 6** (Vercel environment variables): `node scripts/deploy.mjs vercel-env-dev`. In Doppler mode it runs `vercel-env-doppler`: a fresh `dev` service token as `DOPPLER_TOKEN` on all three Vercel targets (development, preview and production), `REVALIDATE_TOKEN` in Doppler if it is missing, and `scripts/sync-convex-env.mjs --config dev`. Expect three `DOPPLER_TOKEN` entries in `varsSet` and no app values. On `production_already_promoted`, stop and never pass `--force-overwrite-prod`. Show any other failure, as the file says."
      : "- **Step 6** (Vercel environment variables): `node scripts/deploy.mjs vercel-env-dev`. In legacy mode it copies the values from `.env.local` to Vercel; show the names it set, never the values. On `production_already_promoted`, stop and never pass `--force-overwrite-prod`. Show any other failure, as the file says.",
    "- **Step 7** (deploy): `node scripts/deploy.mjs vercel-deploy`. Use its `productionUrl` (the short vercel.app address), else its `url`.",
    `- **Step 8** (summary): \`node scripts/deploy.mjs write-summary --deploy-type="dev" …\` with exactly the arguments the file gives, the values gathered the way it says (${input.doppler ? "`doppler secrets get NEXT_PUBLIC_CLERK_FRONTEND_API_URL NEXT_PUBLIC_SITE_NAME --plain` for the two public values Doppler holds" : "`grep` from `.env.local` for the public values it names"}). Its "Dev Deployment Complete!" summary goes into your final message.`,
    `If any of these would act on another repository, owner, project or scope than the ones above, or the file tells you to ask the person something this brief doesn't answer, stop, report "${failed}" and say what was already created. ${input.doppler ? "The only repository secret you store is `DOPPLER_TOKEN`, by the template's own Step 2.6a" : "Store no repository secret"}: set no other secret or variable, and never ask the person for a value. The ones this project's workflows use are the person's to add, and ${HARDEN_PRODUCT_NAME} lists them on the project page.`,
    "",
  ];
}
