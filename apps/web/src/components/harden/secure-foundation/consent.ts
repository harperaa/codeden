import {
  type AutonomyLevel,
  HARDEN_PRODUCT_NAME,
  type SecureFoundationCreated,
  type SecureFoundationDeploy,
  type SecureFoundationRepositoryMode,
  type SecureFoundationSecrets,
  secureFoundationCreates,
  secureFoundationCreatesLine,
  secureFoundationFolder,
} from "@codeden/contracts";
import type { FormAnswers } from "./answers";
import { deployOf } from "./deploy";

/** What the verification view needs to say what will happen. */
export interface ConsentInput {
  name: string;
  projectsDir: string;
  pathSeparator: string;
  secrets: SecureFoundationSecrets;
  convexTeam?: string;
  deploy?: Pick<SecureFoundationDeploy, "owner" | "repository" | "vercelScope">;
  modules: string[];
  provider: { displayName: string; runsCommandFiles: boolean };
  template: { repository: string; branch: string; commit: string; committedAt: string };
  repositoryMode: SecureFoundationRepositoryMode;
  autonomy: AutonomyLevel;
}

const LEVEL: Record<AutonomyLevel, string> = {
  read_only: "Read-only",
  supervised: "Supervised",
  auto: "Auto",
  full: "Full",
};

/** The folder the project is created in, as the server will build it. */
export function projectPath(input: Pick<ConsentInput, "name" | "projectsDir" | "pathSeparator">) {
  const folder = secureFoundationFolder(input.name);
  return folder ? `${input.projectsDir}${input.pathSeparator}${folder}` : "";
}

const day = (iso: string) => iso.slice(0, 10);

/** Said in the full statements and in the form's short lines, in the same words. */
const UNATTENDED = "runs commands inside the new project without asking for each one";
const URL_WHILE = "only works while the setup session's processes are running";

/** What stays off in a quiet project, in the verification view and on the project's page. */
export const QUIET_MEANS =
  "Pull requests, issues and reviews on GitHub don't wake its project manager, and scheduled or event automations and issue triage don't run";
/** How the person turns automatic work on, in the same two places. */
export const QUIET_TURN_ON =
  "To turn automatic work on, change the project's autonomy mode from Manual to Assisted on its page";

/**
 * The statements of the verification view, in order: where, from what, what runs, what it needs from
 * the person, and what the URL at the end is. Plain sentences, built from the same answers the
 * request carries.
 */
export function consentStatements(input: ConsentInput): string[] {
  const { template, provider } = input;
  const product = HARDEN_PRODUCT_NAME;
  const doppler = input.secrets === "doppler";
  const { deploy } = input;
  const fresh = input.repositoryMode === "fresh";
  const repositoryLine = deploy
    ? `The project is created in ${projectPath(input)} ${fresh ? "as a new git repository with one first commit and none of the template's history" : "as a clone of the template, with its history"}. It is then pushed to a new private GitHub repository, ${deploy.owner}/${deploy.repository}.`
    : null;
  return [
    repositoryLine
      ? repositoryLine
      : input.repositoryMode === "fresh"
        ? `The project is created in ${projectPath(input)} as a new local git repository with one first commit: no remote, no link back to the template, and no GitHub repository.`
        : `The project is created in ${projectPath(input)} as a clone of the template, with its history and its remote.`,
    `Its files come from ${template.repository}, branch ${template.branch}, commit ${template.commit.slice(0, 7)} of ${day(template.committedAt)}. Exactly that commit is installed.`,
    "Packages are installed from npm (npm install), which runs those packages' own install scripts.",
    "A Clerk app and a Convex project are created for you (listed below). The sign-ins are checked before anything is created; if one is missing when the setup starts, you are asked to sign in in a browser.",
    doppler
      ? `Doppler: a Doppler project is created and the app's secrets are kept there instead of in a file. It needs the Doppler CLI, installed and signed in (checked before anything is created). ${deploy ? "A Doppler token is stored in the new repository as an Actions secret." : "The CI token step of the install is skipped, because this project has no GitHub repository to hold that token."}`
      : "The app's secrets are written to .env.local in the project folder, a file git ignores. Doppler is not used.",
    input.modules.length > 0
      ? `Content modules installed: ${input.modules.join(", ")}.`
      : "No content modules are installed (minimal shell). You can add them later.",
    ...(deploy
      ? [
          `The site is deployed with the template's dev route to a Vercel project named "${deploy.repository}" in the scope "${deploy.vercelScope}". It is public on a vercel.app address and runs on the development Clerk and Convex. On Vercel this uses the project's production slot, as the template's dev route does; nothing is deployed with production keys.`,
          "With the deploy on, the setup session pushes code and creates the repository and the Vercel project without asking for each command. It is given exactly the names listed below and told to stop and ask if anything differs: another owner, a public repository, a repository or project that already exists, a production deploy.",
        ]
      : []),
    `A setup session runs on ${provider.displayName} at the ${LEVEL[input.autonomy]} permission level: it ${UNATTENDED}. ${provider.runsCommandFiles ? "It runs the template's /install command." : "It reads the template's install instructions and follows them."} ${product}'s protected areas and always-ask rules still apply, and it is told to refuse anything outside the project folder.`,
    "The setup first checks this computer again (Node, npm, git, the sign-ins). Only that part can ask you something, and it lands in the inbox. After it the setup runs without you.",
    `At the end you get the app's local URL${deploy ? " and the deployed URL. The deployed one stays up; the local one" : ". It"} ${URL_WHILE}: stopping or archiving that session, or quitting ${product}, stops the app.`,
    `The new project starts in Manual mode with automatic work off: apart from this setup session, ${product} starts nothing in it by itself. ${QUIET_MEANS}. ${QUIET_TURN_ON}.`,
  ];
}

/** What will exist in the person's accounts afterwards (the same list the session is held to). */
export function consentCreates(
  input: Pick<ConsentInput, "name" | "secrets" | "convexTeam" | "deploy">,
): SecureFoundationCreated[] {
  return secureFoundationCreates(input);
}

/** Said under the list of what is created. */
export const CREATED_STAYS =
  "None of these is removed when you archive the project or delete its folder. Remove each one where it lives.";

/**
 * What the form's answers create in the person's accounts: the list the verification view
 * shows, the list the form's first short line is made from, and (through the same contracts
 * function) the list the setup session is held to. A ticked deploy whose names aren't chosen
 * yet still counts: its repository and Vercel project are named in the verification view.
 */
export function createsOf(
  answers: Pick<
    FormAnswers,
    | "name"
    | "secrets"
    | "convexTeam"
    | "deploy"
    | "deployOwner"
    | "deployRepository"
    | "deployScope"
  >,
): SecureFoundationCreated[] {
  const deploy = deployOf(answers);
  return secureFoundationCreates({
    name: answers.name.trim(),
    secrets: answers.secrets,
    convexTeam: answers.convexTeam,
    deploy: deploy === null ? { owner: "…", repository: "…", vercelScope: "…" } : deploy,
  });
}

/**
 * The lines above the form's buttons, always shown: what is created in the person's accounts,
 * that the setup runs unattended, what the URL at the end is, and that nothing else starts in
 * the new project by itself. Pressing Go is the confirmation of these; the verification view
 * has the full lists.
 */
export function consentSummary(
  answers: Parameters<typeof createsOf>[0],
  autonomy: AutonomyLevel,
): [string, string, string, string] {
  return [
    secureFoundationCreatesLine(createsOf(answers)),
    `The setup session ${UNATTENDED} (${LEVEL[autonomy]} permission level).`,
    answers.deploy
      ? `The app's local URL ${URL_WHILE}; the deployed one stays up.`
      : `The app's URL ${URL_WHILE}.`,
    "The new project starts with automatic work off (Manual mode): nothing else starts in it until you turn that on.",
  ];
}
