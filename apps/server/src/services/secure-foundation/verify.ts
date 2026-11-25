import { lstatSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  SecureFoundationAnswers,
  type SecureFoundationCheck,
  SecureFoundationDeploy,
  type SecureFoundationProvider,
  type SecureFoundationTemplate,
  secureFoundationFolder,
  type VerifySecureFoundationRequest,
  type VerifySecureFoundationResponse,
} from "@codeden/contracts";
import { errorMessage, ServiceError } from "../errors";

/**
 * What "Go" checks on the server before it asks for anything to be created: the form's fields,
 * the folder, the template's commit and the provider. Read-only: it writes nothing, creates
 * nothing and starts nothing, and `create` makes every one of these checks again itself.
 */

export interface VerifyDeps {
  projectsDir: string;
  providers: () => Promise<SecureFoundationProvider[]>;
  /** Resolve the template's branch to a commit (a fetch into a temp folder, removed after). */
  template: () => Promise<SecureFoundationTemplate>;
}

/** What each field is called in the form. The values themselves are never repeated. */
const FIELD: Record<string, string> = {
  name: "The project name isn't one that can be used: letters, digits, spaces, dots, dashes and underscores, starting with a letter or digit, 60 characters at most.",
  adminEmail: "The admin email isn't an address the install accepts (it refuses placeholders).",
  secrets: "The secrets choice isn't one of Doppler and .env.local.",
  shell: "The app shell isn't one of Minimal, All modules and Pick.",
  modules: "A chosen content module has a name the template can't have.",
  provider: "No provider is chosen to run the setup.",
  owner: "The repository owner isn't a GitHub account or organisation name.",
  repository: "The repository name can't be used on GitHub.",
  vercelScope: "The Vercel scope isn't a team's name.",
};

function fieldsCheck(req: VerifySecureFoundationRequest): SecureFoundationCheck {
  const wrong = new Set<string>();
  const answers = SecureFoundationAnswers.safeParse({
    name: req.name,
    adminEmail: req.adminEmail,
    secrets: req.secrets,
    shell: req.shell,
    modules: req.shell === "pick" ? req.modules : [],
    provider: req.provider,
  });
  if (!answers.success) {
    for (const issue of answers.error.issues) wrong.add(String(issue.path[0] ?? ""));
  }
  if (!req.provider) wrong.add("provider");
  // The deploy's parts come from the sign-ins and may not be chosen yet: each one that is there
  // has to be valid. `create` takes all three or none.
  for (const part of ["owner", "repository", "vercelScope"] as const) {
    const value = req.deploy?.[part];
    if (value !== undefined && !SecureFoundationDeploy.shape[part].safeParse(value).success) {
      wrong.add(part);
    }
  }
  const messages = [...wrong].map((field) => FIELD[field]).filter(Boolean);
  if (wrong.size === 0) {
    return { id: "fields", status: "passed", message: "The form's answers are valid.", fix: null };
  }
  return {
    id: "fields",
    status: "failed",
    message: messages.join(" ") || "One of the form's answers isn't valid.",
    fix: "Go back to the form and correct it.",
  };
}

/** The folder a name would be created in, or null when the name makes no folder name. */
export function folderFor(projectsDir: string, name: string): string | null {
  const folder = secureFoundationFolder(name);
  const root = resolve(projectsDir);
  const dest = resolve(root, folder);
  return /^[a-z0-9][a-z0-9-]*$/.test(folder) && dirname(dest) === root ? dest : null;
}

/** True when nothing is at `dest`, or only an empty folder. Reads, never writes. */
export function isFree(dest: string): boolean {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(dest);
  } catch {
    return true;
  }
  try {
    return stat.isDirectory() && readdirSync(dest).length === 0;
  } catch {
    // A folder that can't be read is not one to write into.
    return false;
  }
}

function folderCheck(projectsDir: string, name: string, nameOk: boolean): SecureFoundationCheck {
  const dest = nameOk ? folderFor(projectsDir, name.trim()) : null;
  if (!dest) {
    return {
      id: "folder",
      status: "failed",
      message: "The folder can't be checked until the project name is valid.",
      fix: "Go back to the form and correct the project name.",
    };
  }
  return isFree(dest)
    ? { id: "folder", status: "passed", message: `${dest} is free.`, fix: null }
    : {
        id: "folder",
        status: "failed",
        message: `${dest} already exists.`,
        fix: "Go back to the form and choose another project name, or move that folder away.",
      };
}

function templateCheck(
  req: VerifySecureFoundationRequest,
  template: SecureFoundationTemplate | Error,
): SecureFoundationCheck {
  if (template instanceof Error) {
    return {
      id: "template",
      status: "failed",
      message: `The template's latest commit couldn't be looked up: ${template.message}`,
      fix: "Check this computer's network connection, then check again.",
    };
  }
  const names = template.modules.map((m) => m.name);
  const unknown = req.shell === "pick" ? req.modules.filter((m) => !names.includes(m)) : [];
  if (unknown.length > 0) {
    return {
      id: "template",
      status: "failed",
      message: "The template no longer has one of the content modules you picked.",
      fix: "Go back to the form and pick the modules again.",
    };
  }
  return {
    id: "template",
    status: "passed",
    message: `${template.repository}, branch ${template.branch}, is at commit ${template.commit.slice(0, 7)} of ${template.committedAt.slice(0, 10)}. Exactly that commit is installed.`,
    fix: null,
  };
}

function providerCheck(
  req: VerifySecureFoundationRequest,
  providers: SecureFoundationProvider[],
): SecureFoundationCheck {
  const provider = providers.find((p) => p.id === req.provider);
  if (!provider) {
    return {
      id: "provider",
      status: "failed",
      message: req.provider
        ? "The provider chosen to run the setup isn't signed in on this computer any more."
        : "No signed-in agent provider can run the setup.",
      fix: "Pick another one under Runs on in the form, or sign one in under Settings › Providers.",
    };
  }
  return {
    id: "provider",
    status: "passed",
    message: `${provider.displayName} is signed in and runs the setup. ${provider.runsCommandFiles ? "It runs the template's /install command." : "It reads the template's install instructions and follows them."}`,
    fix: null,
  };
}

/** Every check, whether or not an earlier one failed. */
export async function verifySetup(
  deps: VerifyDeps,
  req: VerifySecureFoundationRequest,
): Promise<VerifySecureFoundationResponse> {
  const [template, providers] = await Promise.all([
    deps.template().catch((error: unknown) => {
      // A build without the option has nothing to verify: that is the caller's error.
      if (error instanceof ServiceError && error.code === "secure_foundation_off") throw error;
      return new Error(errorMessage(error));
    }),
    deps.providers(),
  ]);
  const fields = fieldsCheck(req);
  const nameOk = SecureFoundationAnswers.shape.name.safeParse(req.name).success;
  return {
    checks: [
      fields,
      folderCheck(deps.projectsDir, req.name, nameOk),
      templateCheck(req, template),
      providerCheck(req, providers),
    ],
    template: template instanceof Error ? null : template,
  };
}
