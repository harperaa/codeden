import type {
  CreateSecureFoundationRequestInit,
  SecureFoundationSecrets,
  SecureFoundationShell,
  SecureFoundationTemplate,
  VerifySecureFoundationRequestInit,
} from "@codeden/contracts";
import { deployOf, suggestedRepository } from "./deploy";

/** What the form holds while it is open. Nothing of it is stored anywhere. */
export interface FormAnswers {
  name: string;
  adminEmail: string;
  /** The person typed in the email field: a late suggestion must not replace it. */
  emailTouched: boolean;
  secrets: SecureFoundationSecrets;
  shell: SecureFoundationShell;
  modules: string[];
  provider: string;
  /** The Convex team, from the sign-in; absent: the only one, or asked later. */
  convexTeam?: string;
  /** Also create a GitHub repository and deploy to Vercel (the template's dev route). */
  deploy: boolean;
  /** Chosen in the verification view, once signed in. */
  deployOwner?: string;
  deployRepository?: string;
  deployScope?: string;
}

/** The modules a form's answers install, as the server will work them out. */
export function modulesOf(
  answers: Pick<FormAnswers, "shell" | "modules">,
  template: Pick<SecureFoundationTemplate, "modules">,
): string[] {
  const names = template.modules.map((m) => m.name);
  if (answers.shell === "minimal") return [];
  return answers.shell === "all" ? names : names.filter((n) => answers.modules.includes(n));
}

/** What Go asks the server to check: the form as it stands, right or wrong. */
export function verifyRequestOf(answers: FormAnswers): VerifySecureFoundationRequestInit {
  return {
    name: answers.name,
    adminEmail: answers.adminEmail,
    secrets: answers.secrets,
    shell: answers.shell,
    modules: answers.shell === "pick" ? answers.modules : [],
    provider: answers.provider,
    deploy: answers.deploy
      ? {
          owner: answers.deployOwner,
          repository: answers.deployRepository ?? suggestedRepository(answers),
          vercelScope: answers.deployScope,
        }
      : undefined,
  };
}

/** The create request for verified answers and the commit the checks resolved. */
export function createRequestOf(
  answers: FormAnswers,
  commit: string,
): CreateSecureFoundationRequestInit {
  const deploy = deployOf(answers);
  // A ticked deploy without its owner, name and scope is an error, never a local project.
  if (deploy === null) throw new Error("The deploy's repository and scope are not set.");
  return {
    name: answers.name,
    adminEmail: answers.adminEmail,
    secrets: answers.secrets,
    shell: answers.shell,
    modules: answers.shell === "pick" ? answers.modules : [],
    provider: answers.provider,
    commit,
    convexTeam: answers.convexTeam,
    deploy,
  };
}
