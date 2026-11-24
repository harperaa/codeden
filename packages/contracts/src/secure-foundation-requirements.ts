import { z } from "zod";
import { Timestamp } from "./common";
import type { SecureFoundationSecrets } from "./secure-foundation";
import {
  SECURE_FOUNDATION_NPX_PACKAGES,
  type SecureFoundationService,
} from "./secure-foundation-connections";

/**
 * What Secure Foundation requires of this computer and of the person, written once. The
 * requirements page (`GET /api/secure-foundation/requirements`, this computer only), the
 * sign-in checks Go makes (`secureFoundationServices`), the install hint of a missing tool and
 * the Node.js version the setup session's brief asks for all read this list.
 *
 * The check answers only whether a tool was found, its version and whether its own sign-in
 * holds. No account name, token or command output is part of it.
 */

/** When a requirement applies: always, with secrets in Doppler, or with the deploy option. */
export const SecureFoundationNeededFor = z.enum(["always", "doppler", "deploy"]);
export type SecureFoundationNeededFor = z.infer<typeof SecureFoundationNeededFor>;

/** The oldest Node.js major version the template's install accepts (its Phase 1, step 1). */
export const SECURE_FOUNDATION_MIN_NODE_MAJOR = 18;

/** The local tools the setup runs. `convex` and `vercel` run through `npx`, pinned. */
export const SecureFoundationToolId = z.enum([
  "node",
  "npm",
  "git",
  "convex",
  "doppler",
  "gh",
  "vercel",
]);
export type SecureFoundationToolId = z.infer<typeof SecureFoundationToolId>;

/** The operating systems an install command is written for. */
export const SecureFoundationPlatform = z.enum(["darwin", "win32", "linux"]);
export type SecureFoundationPlatform = z.infer<typeof SecureFoundationPlatform>;

export interface SecureFoundationToolRequirement {
  id: SecureFoundationToolId;
  label: string;
  neededFor: SecureFoundationNeededFor;
  /** What the setup uses it for, as one short sentence. */
  why: string;
  /** The program whose `--version` is asked; null for a tool that runs through `npx`. */
  program: string | null;
  /** The pinned package `npx` runs (never installed by the person). */
  npxPackage?: string;
  /** The service whose sign-in this tool holds (asked with the sign-in checks' own command). */
  service?: SecureFoundationService;
  /** The oldest major version that works. */
  minMajor?: number;
  /** The install command per system; null where there is no single command (see `installUrl`). */
  install: Record<SecureFoundationPlatform, string | null>;
  /** The tool's official install page. */
  installUrl: string;
}

const withNode = { darwin: null, win32: null, linux: null };

/** Every local tool, in the order the page shows them. */
export const SECURE_FOUNDATION_TOOLS: readonly SecureFoundationToolRequirement[] = [
  {
    id: "node",
    label: "Node.js",
    neededFor: "always",
    why: `Runs the template's install and the app. Version ${SECURE_FOUNDATION_MIN_NODE_MAJOR} or newer.`,
    program: "node",
    minMajor: SECURE_FOUNDATION_MIN_NODE_MAJOR,
    install: {
      darwin: "brew install node",
      win32: "winget install --id OpenJS.NodeJS.LTS",
      linux: null,
    },
    installUrl: "https://nodejs.org/en/download",
  },
  {
    id: "npm",
    label: "npm",
    neededFor: "always",
    why: "Installs the project's packages. It comes with Node.js, as does npx.",
    program: "npm",
    install: withNode,
    installUrl: "https://nodejs.org/en/download",
  },
  {
    id: "git",
    label: "git",
    neededFor: "always",
    why: "Fetches the template and makes the new repository.",
    program: "git",
    install: {
      darwin: "xcode-select --install",
      win32: "winget install --id Git.Git",
      linux: null,
    },
    installUrl: "https://git-scm.com/downloads",
  },
  {
    id: "convex",
    label: "Convex CLI",
    neededFor: "always",
    why: "Creates the Convex project. Runs through npx: nothing to install.",
    program: null,
    npxPackage: SECURE_FOUNDATION_NPX_PACKAGES.convex,
    service: "convex",
    install: withNode,
    installUrl: "https://nodejs.org/en/download",
  },
  {
    id: "doppler",
    label: "Doppler CLI",
    neededFor: "doppler",
    why: "Creates the Doppler project and keeps the secrets in it.",
    program: "doppler",
    service: "doppler",
    install: {
      darwin: "brew install gnupg && brew install dopplerhq/cli/doppler",
      win32: "winget install doppler.doppler",
      linux: null,
    },
    installUrl: "https://docs.doppler.com/docs/install-cli",
  },
  {
    id: "gh",
    label: "GitHub CLI",
    neededFor: "deploy",
    why: "Creates the GitHub repository.",
    program: "gh",
    service: "github",
    install: {
      darwin: "brew install gh",
      win32: "winget install --id GitHub.cli",
      linux: null,
    },
    installUrl: "https://cli.github.com",
  },
  {
    id: "vercel",
    label: "Vercel CLI",
    neededFor: "deploy",
    why: "Creates the Vercel project and deploys the site. Runs through npx: nothing to install.",
    program: null,
    npxPackage: SECURE_FOUNDATION_NPX_PACKAGES.vercel,
    service: "vercel",
    install: withNode,
    installUrl: "https://nodejs.org/en/download",
  },
];

/** The tool with this id. */
export function secureFoundationTool(id: SecureFoundationToolId): SecureFoundationToolRequirement {
  const tool = SECURE_FOUNDATION_TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown Secure Foundation tool: ${id}`);
  return tool;
}

/** The system an install command is shown for; anything that isn't macOS or Windows is Linux. */
export function secureFoundationPlatform(platform: string): SecureFoundationPlatform {
  return platform === "darwin" || platform === "win32" ? platform : "linux";
}

/**
 * What a person runs to install a tool on `platform`, as one line: the command, or a pointer to
 * the tool's install page where there is no single command.
 */
export function secureFoundationInstallHint(id: SecureFoundationToolId, platform: string): string {
  const tool = secureFoundationTool(id);
  return tool.install[secureFoundationPlatform(platform)] ?? `See ${tool.installUrl}`;
}

/** The services the setup needs an account for. */
export const SecureFoundationAccountId = z.enum(["clerk", "convex", "doppler", "github", "vercel"]);
export type SecureFoundationAccountId = z.infer<typeof SecureFoundationAccountId>;

export interface SecureFoundationAccountRequirement {
  id: SecureFoundationAccountId;
  label: string;
  neededFor: SecureFoundationNeededFor;
  /** What the setup creates there, as one short sentence. */
  why: string;
  /** The service's own page to create an account or sign in. */
  url: string;
  /**
   * The tool whose sign-in shows that the account exists. Without one (Clerk) nothing on this
   * computer can tell, and the page says so instead of a pass or a fail.
   */
  tool?: SecureFoundationToolId;
}

/** Every account, in the order the page shows them. */
export const SECURE_FOUNDATION_ACCOUNTS: readonly SecureFoundationAccountRequirement[] = [
  {
    id: "clerk",
    label: "Clerk",
    neededFor: "always",
    why: "You'll need a Clerk account to claim your app after the install.",
    url: "https://dashboard.clerk.com/sign-up",
  },
  {
    id: "convex",
    label: "Convex",
    neededFor: "always",
    why: "Your app's database and backend.",
    url: "https://dashboard.convex.dev",
    tool: "convex",
  },
  {
    id: "doppler",
    label: "Doppler",
    neededFor: "doppler",
    why: "Keeps your app's secrets.",
    url: "https://dashboard.doppler.com/register",
    tool: "doppler",
  },
  {
    id: "github",
    label: "GitHub",
    neededFor: "deploy",
    why: "Holds the new project's repository.",
    url: "https://github.com/signup",
    tool: "gh",
  },
  {
    id: "vercel",
    label: "Vercel",
    neededFor: "deploy",
    why: "Hosts the deployed site.",
    url: "https://vercel.com/signup",
    tool: "vercel",
  },
];

/** Whether a requirement applies to these answers (the form's, or its defaults). */
export function secureFoundationNeeds(
  neededFor: SecureFoundationNeededFor,
  answers: { secrets: SecureFoundationSecrets; deploy?: boolean },
): boolean {
  if (neededFor === "doppler") return answers.secrets === "doppler";
  if (neededFor === "deploy") return answers.deploy === true;
  return true;
}

/** The services a form's answers need, in the order the step shows them. */
export function secureFoundationServices(answers: {
  secrets: SecureFoundationSecrets;
  /** The deploy option is ticked. */
  deploy?: boolean;
}): SecureFoundationService[] {
  return SECURE_FOUNDATION_TOOLS.flatMap((tool) =>
    tool.service && secureFoundationNeeds(tool.neededFor, answers) ? [tool.service] : [],
  );
}

/**
 * Where a tool stands: `ok`; `missing` (not found on the app's path); `outdated` (older than
 * its `minMajor`); `needs_sign_in` (its own sign-in doesn't hold); `needs_permission` (signed
 * in, but short of a permission the deploy needs); `unknown` (the check failed or took too
 * long, so nothing is claimed either way).
 */
export const SecureFoundationToolState = z.enum([
  "ok",
  "missing",
  "outdated",
  "needs_sign_in",
  "needs_permission",
  "unknown",
]);
export type SecureFoundationToolState = z.infer<typeof SecureFoundationToolState>;

/** One tool's check. Nothing personal and nothing a CLI printed, except its version number. */
export const SecureFoundationToolCheck = z.object({
  id: SecureFoundationToolId,
  state: SecureFoundationToolState,
  /** Null when it couldn't be determined. */
  found: z.boolean().nullable(),
  /** The version number alone (`22.11.0`); null when unknown. */
  version: z
    .string()
    .regex(/^[\w.+-]{1,40}$/)
    .nullable(),
  /** The tool's own sign-in; null when it has none or it couldn't be asked. */
  signedIn: z.boolean().nullable(),
  /** One line for the person. */
  message: z.string().max(400),
});
export type SecureFoundationToolCheck = z.infer<typeof SecureFoundationToolCheck>;

/** `GET /api/secure-foundation/requirements`: every tool of `SECURE_FOUNDATION_TOOLS`, checked. */
export const SecureFoundationRequirements = z.object({
  checkedAt: Timestamp,
  /** The system of the computer running the app: which install command applies. */
  platform: SecureFoundationPlatform,
  tools: z.array(SecureFoundationToolCheck),
});
export type SecureFoundationRequirements = z.infer<typeof SecureFoundationRequirements>;

/**
 * What the checks come to before the form has any answers. Only what every setup needs counts
 * (the local tools and Convex): a tool that only an option needs never shows the page by itself.
 * `attention`: one of those isn't `ok`, so the page is shown. `blocking`: one is missing, too
 * old or signed out, so the setup would stop; one that couldn't be checked doesn't block.
 */
export function secureFoundationRequirementsSummary(
  result: Pick<SecureFoundationRequirements, "tools">,
): { blocking: boolean; attention: boolean } {
  const open = result.tools.filter(
    (t) => t.state !== "ok" && secureFoundationTool(t.id).neededFor === "always",
  );
  return { attention: open.length > 0, blocking: open.some((t) => t.state !== "unknown") };
}
