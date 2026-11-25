import {
  type SecureFoundationConnection,
  SecureFoundationDeploy,
  secureFoundationFolder,
} from "@codeden/contracts";
import type { FormAnswers } from "./answers";

/** The repository name the form suggests: the folder's. */
export function suggestedRepository(answers: Pick<FormAnswers, "name">): string {
  return secureFoundationFolder(answers.name);
}

/**
 * The repository owner the form shows selected (the template's `/deploy-to-dev` Step 1.5 asks
 * for it): the one the person picked, else the one the last deploy used, else their own account
 * (the first of `owners`). Only a name GitHub listed for this sign-in is ever selected.
 */
export function selectedOwner(
  github: Pick<SecureFoundationConnection, "owners" | "lastOwner"> | undefined,
  chosen: string | undefined,
): string | undefined {
  const owners = github?.owners ?? [];
  if (chosen && owners.includes(chosen)) return chosen;
  if (github?.lastOwner && owners.includes(github.lastOwner)) return github.lastOwner;
  return owners[0];
}

/**
 * The deploy part of the request, from the form's answers: undefined when the option is off,
 * null when it is on but not complete or not valid yet.
 */
export function deployOf(
  answers: Pick<
    FormAnswers,
    "name" | "deploy" | "deployOwner" | "deployRepository" | "deployScope"
  >,
): SecureFoundationDeploy | null | undefined {
  if (!answers.deploy) return undefined;
  const parsed = SecureFoundationDeploy.safeParse({
    owner: answers.deployOwner,
    repository: answers.deployRepository ?? suggestedRepository(answers),
    vercelScope: answers.deployScope,
  });
  return parsed.success ? parsed.data : null;
}
