import { hardenDocsUrl } from "@codeden/contracts";

/** The option's card, as the owner wrote it. */
export const SECURE_FOUNDATION_TITLE = "Secure Foundation";
export const SECURE_FOUNDATION_SUBTITLE =
  "Hardened Nextjs, Clerk Billing, Convex, Doppler, Vercel stack.";

/** The user guide. */
export const secureFoundationDocsUrl = () => hardenDocsUrl("secure-foundation.md");

/** The guide's section on the quiet state a new project starts in, and turning it off. */
export const secureFoundationQuietUrl = () =>
  `${secureFoundationDocsUrl()}#automatic-work-starts-off`;

/** The guide's section on the repository secrets the project's workflows need. */
export const secureFoundationRepoSecretsUrl = () =>
  `${secureFoundationDocsUrl()}#repository-secrets-the-projects-workflows-need`;

/** The guide's section on removing the project and what stays in the person's accounts. */
export const secureFoundationRemovalUrl = () => `${secureFoundationDocsUrl()}#removing-the-project`;
