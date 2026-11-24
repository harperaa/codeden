import {
  SECURE_FOUNDATION_TEMPLATE_MOVED,
  type SecureFoundationCheckStatus,
  type SecureFoundationConnection,
  type SecureFoundationService,
  type SecureFoundationTemplate,
  secureFoundationServices,
  type VerifySecureFoundationResponse,
} from "@codeden/contracts";
import type { CodeDenClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/http";
import { type FormAnswers, verifyRequestOf } from "./answers";
import { deployOf, selectedOwner } from "./deploy";

/**
 * What Go checks, in one pass, before it asks for anything to be created: the server's checks
 * (fields, folder, template commit, provider) and the sign-in of each service the answers need.
 * The verification view shows the same list.
 */

export type CheckId =
  | "fields"
  | "folder"
  | "template"
  | "provider"
  | "signins"
  | SecureFoundationService
  | "deploy"
  | "answers"
  | "create";

export interface CheckItem {
  id: CheckId;
  label: string;
  status: SecureFoundationCheckStatus;
  /** What was found. */
  message: string;
  /** What to do about it; null when it passed. */
  fix: string | null;
  /**
   * This run creates nothing, wherever Go was pressed: something is wrong, or a choice was made
   * for the person (a team, the deploy's names, a newer commit) that they haven't seen yet.
   */
  blocking: boolean;
  /** A service's sign-in state: its row has the login button. */
  connection?: SecureFoundationConnection;
}

export interface Verification {
  items: CheckItem[];
  /** The commit the checks resolved; null when the template couldn't be reached. */
  template: SecureFoundationTemplate | null;
  /** Choices the sign-ins settled (the only Convex team, the deploy's owner and scope). */
  patch: Partial<FormAnswers>;
}

const LABEL: Record<CheckId, string> = {
  fields: "Form",
  folder: "Project folder",
  template: "Template",
  provider: "Runs on",
  signins: "Sign-ins",
  convex: "Convex",
  doppler: "Doppler",
  github: "GitHub",
  vercel: "Vercel",
  clerk: "Clerk",
  deploy: "Deploy",
  answers: "Your answers",
  create: "Creating the project",
};
export const checkLabel = (id: CheckId) => LABEL[id];

const day = (iso: string) => iso.slice(0, 10);

function serverItems(
  server: VerifySecureFoundationResponse,
  shownCommit: string | undefined,
): CheckItem[] {
  return server.checks.map((check) => {
    const item: CheckItem = {
      ...check,
      label: LABEL[check.id],
      blocking: check.status !== "passed",
    };
    const now = server.template;
    // The commit on the form is the one the person saw: another one is shown before it is used.
    if (check.id === "template" && check.status === "passed" && now && shownCommit) {
      if (now.commit !== shownCommit) {
        return {
          ...item,
          status: "needs_you",
          blocking: true,
          message: `The template changed while the form was open: ${now.repository} is now at commit ${now.commit.slice(0, 7)} of ${day(now.committedAt)}. That commit is installed.`,
          fix: "Press Go to install the new commit.",
        };
      }
    }
    return item;
  });
}

function connectionItem(c: SecureFoundationConnection, severalTeams: boolean): CheckItem {
  const base = { id: c.service, label: LABEL[c.service], message: c.message, connection: c };
  if (c.cli === "missing") {
    return {
      ...base,
      status: "needs_you",
      blocking: true,
      fix: "Install it yourself in a terminal, then check again.",
    };
  }
  if (c.signedIn === false) {
    return {
      ...base,
      status: "needs_you",
      blocking: true,
      fix: `Sign in to ${LABEL[c.service]} with the button, then press Go.`,
    };
  }
  if (c.missingScopes.length > 0) {
    return {
      ...base,
      status: "needs_you",
      blocking: true,
      fix: "Add the permission with the button, then press Go.",
    };
  }
  if (c.signedIn === null) {
    return {
      ...base,
      status: "needs_you",
      blocking: false,
      fix: "Check again, or press Go: the setup session checks it again and asks you there.",
    };
  }
  if (severalTeams) {
    return {
      ...base,
      status: "needs_you",
      blocking: true,
      message: `${c.message} This account has several teams.`,
      fix: "Choose the team the project is created in below, then press Go.",
    };
  }
  return { ...base, status: "passed", blocking: false, fix: null };
}

/** The sign-ins couldn't be asked for at all: another device, or the request failed. */
function uncheckedItem(error: unknown, deploy: boolean): CheckItem {
  const remote = error instanceof ApiRequestError && error.status === 403;
  const why = error instanceof Error ? error.message : String(error);
  return {
    id: "signins",
    label: LABEL.signins,
    status: "needs_you",
    blocking: deploy,
    message: remote
      ? "Sign-ins can only be checked on the computer running the app, and this is another device."
      : `The sign-ins couldn't be checked (${why}).`,
    fix: deploy
      ? "The deploy needs its GitHub and Vercel sign-ins checked on the computer running the app: go back and untick Deploy to go on without it, or start this there."
      : "Press Go to go on without the check: the setup session checks the sign-ins on the computer it runs on and asks you there.",
  };
}

/** Where the deploy goes, settled from the two sign-ins (the account and the first scope). */
function deployItem(
  answers: FormAnswers,
  connections: SecureFoundationConnection[],
  patch: Partial<FormAnswers>,
): CheckItem {
  const github = connections.find((c) => c.service === "github");
  const vercel = connections.find((c) => c.service === "vercel");
  const base = { id: "deploy" as const, label: LABEL.deploy };
  if (github?.signedIn !== true || vercel?.signedIn !== true) {
    return {
      ...base,
      status: "needs_you",
      blocking: true,
      message: "Where the site is published is chosen once GitHub and Vercel are signed in.",
      fix: "Sign in to both, then check again.",
    };
  }
  const owner = selectedOwner(github, answers.deployOwner);
  const scope = vercel.scopes.some((s) => s.slug === answers.deployScope)
    ? answers.deployScope
    : vercel.scopes[0]?.slug;
  const fresh = owner !== answers.deployOwner || scope !== answers.deployScope;
  if (fresh) Object.assign(patch, { deployOwner: owner, deployScope: scope });
  const settled = deployOf({ ...answers, deployOwner: owner, deployScope: scope });
  if (!settled) {
    return {
      ...base,
      status: "needs_you",
      blocking: true,
      message: "The repository's owner and name and the Vercel scope aren't settled.",
      fix: "Set them below, then press Go.",
    };
  }
  const message = `The site is published from a new private repository, ${settled.owner}/${settled.repository}, as a Vercel project in the scope "${settled.vercelScope}".`;
  // Names the person hasn't seen yet are shown once before anything is created with them.
  return fresh
    ? {
        ...base,
        status: "needs_you",
        blocking: true,
        message,
        fix: "Check the names below, then press Go.",
      }
    : { ...base, status: "passed", blocking: false, message, fix: null };
}

function signinItems(
  answers: FormAnswers,
  connections: SecureFoundationConnection[],
  patch: Partial<FormAnswers>,
): CheckItem[] {
  const teams = connections.find((c) => c.service === "convex")?.teams ?? [];
  const chosen = teams.some((t) => t.slug === answers.convexTeam);
  // The only team is used as it is; the first of several is preselected and shown once.
  if (!chosen && answers.convexTeam !== teams[0]?.slug) patch.convexTeam = teams[0]?.slug;
  const items = connections.map((c) =>
    connectionItem(c, c.service === "convex" && teams.length > 1 && !chosen),
  );
  if (answers.deploy) items.push(deployItem(answers, connections, patch));
  return items;
}

/** Run every check once. Creates nothing; `shownCommit` is the commit the form shows. */
export async function runVerification(
  client: CodeDenClient,
  answers: FormAnswers,
  shownCommit: string | undefined,
): Promise<Verification> {
  const patch: Partial<FormAnswers> = {};
  const [server, signins] = await Promise.all([
    client.secureFoundation.verify(verifyRequestOf(answers)).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    ),
    client.secureFoundation.connections(secureFoundationServices(answers)).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    ),
  ]);
  const items: CheckItem[] =
    "value" in server
      ? serverItems(server.value, shownCommit)
      : [
          {
            id: "fields",
            label: LABEL.fields,
            status: "failed",
            blocking: true,
            message: `The form couldn't be checked: ${server.error instanceof Error ? server.error.message : String(server.error)}`,
            fix: "Check again.",
          },
        ];
  if ("value" in signins) items.push(...signinItems(answers, signins.value.connections, patch));
  else items.push(uncheckedItem(signins.error, answers.deploy));
  return { items, template: "value" in server ? server.value.template : null, patch };
}

/**
 * Whether Go may create now. From the form everything has to have passed: whatever needs the
 * person is shown first. From the verification view only what blocks holds: a sign-in that
 * couldn't be checked is on the page, and the setup session checks it again.
 */
export function canGo(verification: Verification, from: "form" | "view"): boolean {
  if (!verification.template) return false;
  return from === "form"
    ? verification.items.every((i) => i.status === "passed")
    : !verification.items.some((i) => i.blocking);
}

const RANK: Record<SecureFoundationCheckStatus, number> = { failed: 0, needs_you: 1, passed: 2 };

/** Failed first, then what needs the person, then what passed; otherwise the order checked. */
export function failuresFirst(items: CheckItem[]): CheckItem[] {
  return [...items].sort((a, b) => RANK[a.status] - RANK[b.status]);
}

/** The checks after the server refused the create: its reason, on the check it belongs to. */
export function withCreateFailure(items: CheckItem[], error: unknown): CheckItem[] {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof ApiRequestError ? error.code : "";
  const mark = (id: CheckId, patch: Partial<CheckItem>) =>
    items.map((i) => (i.id === id ? { ...i, status: "failed" as const, message, ...patch } : i));
  if (code === "destination_exists" || code === "invalid_name") {
    return mark("folder", {
      blocking: true,
      fix: "Go back to the form and choose another project name.",
    });
  }
  if (code === "provider_unavailable") {
    return mark("provider", { blocking: true, fix: "Pick another one under Runs on in the form." });
  }
  if (code === SECURE_FOUNDATION_TEMPLATE_MOVED) {
    return mark("template", {
      status: "needs_you",
      blocking: false,
      fix: "Nothing was created. Press Go to install the new commit.",
    });
  }
  if (code === "fetch_failed") {
    return mark("template", { blocking: true, fix: "Nothing was created. Check again." });
  }
  return [
    ...items,
    {
      id: "create",
      label: LABEL.create,
      status: "failed",
      blocking: false,
      message,
      fix: "Press Go to try again.",
    },
  ];
}

/** The checks of a run whose answers were edited while it ran: it creates nothing. */
export function withAnswersChanged(items: CheckItem[]): CheckItem[] {
  return [
    ...items,
    {
      id: "answers",
      label: LABEL.answers,
      status: "needs_you",
      blocking: true,
      message: "An answer changed while Go was checking, so these checks are of the earlier ones.",
      fix: "Nothing was created. Press Go to check what is on the form now.",
    },
  ];
}
