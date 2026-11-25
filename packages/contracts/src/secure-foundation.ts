import { z } from "zod";
import { AutonomyLevel, Id, ProviderId, Timestamp } from "./common";
import { Project } from "./entities/project";
import type { Session } from "./entities/session";
import type { AutonomyMode } from "./factory";

/**
 * "Secure Foundation": the add-project option that creates a new project from the fork's
 * template repository (`HARDEN_TEMPLATE_REPOSITORY`) and starts a setup session that runs the
 * template's own install with the answers of one up-front form. Routes: `/api/secure-foundation`.
 *
 * The four defaults a fork owner may want to flip are the constants below, one each.
 */

/** Where the installed app keeps its secrets: a local `.env.local`, or Doppler. */
export const SecureFoundationSecrets = z.enum(["env_local", "doppler"]);
export type SecureFoundationSecrets = z.infer<typeof SecureFoundationSecrets>;

/** Default 1 of 4: the secrets mode the form starts with. */
export const SECURE_FOUNDATION_DEFAULT_SECRETS: SecureFoundationSecrets = "doppler";

/**
 * Default 2 of 4: the permission level of the setup session. `full` runs commands inside the
 * new project without asking; protected areas and "always ask" rules still apply at every level.
 */
export const SECURE_FOUNDATION_SETUP_AUTONOMY: AutonomyLevel = "full";

/**
 * What the new project's repository is: `fresh` is the template's files as one new initial
 * commit with no remote and no template history; `clone` keeps the template's history and its
 * `origin` remote.
 */
export const SecureFoundationRepositoryMode = z.enum(["fresh", "clone"]);
export type SecureFoundationRepositoryMode = z.infer<typeof SecureFoundationRepositoryMode>;

/** Default 3 of 4: the new project is a fresh local repository. */
export const SECURE_FOUNDATION_REPOSITORY_MODE: SecureFoundationRepositoryMode = "fresh";

// Default 4 of 4, the template version, is the build variable `TEMPLATE_BRANCH`
// (`HARDEN_TEMPLATE_BRANCH`, default `main`): the branch's latest commit at the time of the click.

/**
 * Whether the form starts with "create a GitHub repository and deploy to Vercel" ticked. Off:
 * the project stays local unless the person ticks it.
 */
export const SECURE_FOUNDATION_DEFAULT_DEPLOY = false;

/**
 * The deploy part of a setup, chosen in the form: the GitHub repository that is created and
 * the Vercel scope the project is created in. The template's dev route creates the repository
 * private; no other visibility can be asked for.
 */
export const SecureFoundationDeploy = z.object({
  /** The GitHub account or organisation that will own the repository. */
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
  /** The repository's name, also the Vercel project's. */
  repository: z
    .string()
    .regex(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/)
    .refine((v) => !v.endsWith(".git") && !v.endsWith("."), "Not a repository name"),
  visibility: z.literal("private").default("private"),
  /** The Vercel team (scope) slug the project is created in. */
  vercelScope: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/),
});
export type SecureFoundationDeploy = z.infer<typeof SecureFoundationDeploy>;

/** How much of the app is installed: no content modules, all of them, or a chosen set. */
export const SecureFoundationShell = z.enum(["minimal", "all", "pick"]);
export type SecureFoundationShell = z.infer<typeof SecureFoundationShell>;

/** The app shell the form starts with: every content module the template has. */
export const SECURE_FOUNDATION_DEFAULT_SHELL: SecureFoundationShell = "all";

/**
 * The project's name: also the site name, and the folder name is made from it
 * (`secureFoundationFolder`). Starts with a letter or digit; letters, digits, spaces, dots,
 * dashes and underscores after that, so no path can be written in it.
 */
export const SecureFoundationName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/,
    "Use letters, digits, spaces, dots, dashes and underscores, starting with a letter or digit",
  );

/**
 * The folder a project name is created in, inside the projects folder: lower case, every other
 * run of characters one dash, 40 characters at most. Only `[a-z0-9-]`, never empty for a valid
 * `SecureFoundationName`. The template derives its Convex project name the same way, and its
 * Doppler project name nearly so (`secureFoundationDopplerProject`).
 */
export function secureFoundationFolder(name: string): string {
  // One pass, no regular expression: the cost is linear whatever the input.
  let folder = "";
  for (const ch of name.slice(0, 200).toLowerCase()) {
    const kept = (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
    if (kept) folder += ch;
    else if (folder && !folder.endsWith("-")) folder += "-";
  }
  folder = folder.slice(0, 40);
  while (folder.endsWith("-")) folder = folder.slice(0, -1);
  return folder;
}

/**
 * The Doppler project the template's install creates for a project name
 * (`scripts/setup.mjs doppler-bootstrap --project-name`): lower case, every other run of
 * characters one dash, no dash at either end, then the first 40 characters. Kept in step with
 * the template: unlike `secureFoundationFolder` it cuts last, so a name can end in a dash.
 */
export function secureFoundationDopplerProject(name: string): string {
  // One pass, no regular expression: the cost is linear whatever the input.
  let slug = "";
  for (const ch of name.slice(0, 200).toLowerCase()) {
    const kept = (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
    if (kept) slug += ch;
    else if (slug && !slug.endsWith("-")) slug += "-";
  }
  while (slug.endsWith("-")) slug = slug.slice(0, -1);
  return slug.slice(0, 40);
}

/** Addresses the template's install refuses as placeholders. */
const PLACEHOLDER_EMAILS = [
  "example@example.com",
  "admin@example.com",
  "user@example.com",
  "test@example.com",
];

/**
 * The site admin's email, as the template's install accepts it: something@domain.tld, and not
 * one of its known placeholders. Personal data: it goes to the install and nowhere else.
 */
export const SecureFoundationEmail = z
  .string()
  .trim()
  .max(254)
  .regex(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/, "Enter an email address")
  .refine((v) => !PLACEHOLDER_EMAILS.includes(v.toLowerCase()), "Enter a real email address");

/** A content module's name, as the template's `templates/modules/<name>` folder. */
export const SecureFoundationModuleName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/** A content module the template offers at the resolved commit. */
export const SecureFoundationModule = z.object({
  name: SecureFoundationModuleName,
  title: z.string().max(80),
  description: z.string().max(300),
});
export type SecureFoundationModule = z.infer<typeof SecureFoundationModule>;

/** A full commit id. */
export const SecureFoundationCommit = z.string().regex(/^[0-9a-f]{40}$/);

/** A provider that can run the setup session. */
export const SecureFoundationProvider = z.object({
  id: ProviderId,
  displayName: z.string(),
  /** It runs the template's `/install` command file itself (`capabilities.projectCommands`). */
  runsCommandFiles: z.boolean(),
});
export type SecureFoundationProvider = z.infer<typeof SecureFoundationProvider>;

/**
 * `GET /api/secure-foundation`: whether the option exists in this build and what the form needs
 * before anything is fetched. Nothing personal.
 */
export const SecureFoundationOptions = z.object({
  /** False when the build has no template (`HARDEN_TEMPLATE_REPOSITORY` empty). */
  enabled: z.boolean(),
  /** The template's `owner/repo` and branch; null when off. */
  template: z.object({ repository: z.string(), branch: z.string() }).nullable(),
  /** The folder new projects are created in, and this machine's path separator. */
  projectsDir: z.string(),
  pathSeparator: z.enum(["/", "\\"]),
  /** Signed-in providers that can run the setup, the one a new session would use first. */
  providers: z.array(SecureFoundationProvider),
  defaults: z.object({
    secrets: SecureFoundationSecrets,
    shell: SecureFoundationShell,
    /** Whether the deploy option starts ticked (`SECURE_FOUNDATION_DEFAULT_DEPLOY`). */
    deploy: z.boolean().default(false),
  }),
  repositoryMode: SecureFoundationRepositoryMode,
  autonomy: AutonomyLevel,
});
export type SecureFoundationOptions = z.infer<typeof SecureFoundationOptions>;

/**
 * `GET /api/secure-foundation/prefill`: suggestions for the form, read on the person's own
 * machine from the sources the template's install uses, shown only to them and stored nowhere.
 * A source that is missing gives null. Answered with nulls to another device.
 */
export const SecureFoundationPrefill = z.object({
  adminEmail: z.string().nullable(),
});
export type SecureFoundationPrefill = z.infer<typeof SecureFoundationPrefill>;

/**
 * `POST /api/secure-foundation/template`: the commit the template's branch points at now, with
 * its content modules. This is the commit the form shows and `create` installs.
 */
export const SecureFoundationTemplate = z.object({
  repository: z.string(),
  branch: z.string(),
  commit: SecureFoundationCommit,
  /** When the commit was made. */
  committedAt: Timestamp,
  modules: z.array(SecureFoundationModule),
});
export type SecureFoundationTemplate = z.infer<typeof SecureFoundationTemplate>;

/** `POST /api/secure-foundation/projects`: the confirmed form. No field names a URL or a path. */
export const CreateSecureFoundationRequest = z.object({
  name: SecureFoundationName,
  adminEmail: SecureFoundationEmail,
  secrets: SecureFoundationSecrets.default(SECURE_FOUNDATION_DEFAULT_SECRETS),
  shell: SecureFoundationShell.default(SECURE_FOUNDATION_DEFAULT_SHELL),
  /** The chosen modules when `shell` is `pick`; ignored otherwise. */
  modules: z.array(SecureFoundationModuleName).max(20).default([]),
  /** One of `SecureFoundationOptions.providers`. */
  provider: ProviderId,
  /** The commit the person saw and confirmed; another commit on the branch is refused. */
  commit: SecureFoundationCommit,
  /**
   * The Convex team the project is created in, chosen in the verification view. Omitted: the
   * account's only team, or the setup session asks when there are several.
   */
  convexTeam: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
    .optional(),
  /**
   * Also create a GitHub repository and deploy to Vercel with the template's dev route.
   * Omitted: the project stays local.
   */
  deploy: SecureFoundationDeploy.optional(),
});
export type CreateSecureFoundationRequest = z.infer<typeof CreateSecureFoundationRequest>;
export type CreateSecureFoundationRequestInit = z.input<typeof CreateSecureFoundationRequest>;

/** `POST /api/secure-foundation/projects` response: the new project and its setup session. */
export const CreateSecureFoundationResponse = z.object({
  project: Project,
  sessionId: Id,
  commit: SecureFoundationCommit,
});
export type CreateSecureFoundationResponse = z.infer<typeof CreateSecureFoundationResponse>;

/**
 * Error codes of `create` beyond validation: `template_moved` (the branch points at another
 * commit than the one confirmed: resolve again and ask again), `destination_exists`,
 * `provider_unavailable`, `secure_foundation_off`, and `<step>_failed` for the step that failed
 * (`fetch`, `files`, `repository`, `project`, `session`), after cleaning up.
 */
export const SECURE_FOUNDATION_TEMPLATE_MOVED = "template_moved";

/**
 * `GET /api/secure-foundation/projects/:id/finish`: what the finished install left for the
 * person, read from the project's `docs/INSTALL.md`. The claim URL is shown to the person on
 * this computer only and stored nowhere.
 */
export const SecureFoundationFinish = z.object({
  /** Where the person claims the accountless Clerk app; null when there is none (yet). */
  clerkClaimUrl: z.string().nullable(),
  /** The deployed site, from `docs/DEPLOYMENT-DEV.md`; null when nothing was deployed. */
  deployedUrl: z.string().nullable().default(null),
});
export type SecureFoundationFinish = z.infer<typeof SecureFoundationFinish>;

// ------------------------------------------------------- what gets created

/** One thing a setup creates in the person's accounts, and where it is removed again. */
export interface SecureFoundationCreated {
  service: "Clerk" | "Convex" | "Doppler" | "GitHub" | "Vercel";
  /** What it is in a few words, for the one line above the form's buttons. */
  short: string;
  /** What it is and its name, as one phrase. */
  item: string;
  /** Where the person removes it. */
  removeAt: string;
}

/**
 * Everything a setup with these answers creates outside the project folder. The form's line
 * above its buttons, the verification view's list and the setup session's brief all come from
 * this one function, so what the person confirms with Go is what the session may create.
 */
export function secureFoundationCreates(answers: {
  name: string;
  secrets: SecureFoundationSecrets;
  convexTeam?: string;
  deploy?: Pick<SecureFoundationDeploy, "owner" | "repository" | "vercelScope">;
}): SecureFoundationCreated[] {
  const slug = secureFoundationFolder(answers.name);
  const created: SecureFoundationCreated[] = [
    {
      service: "Clerk",
      short: "a Clerk app",
      item: "an accountless Clerk app (yours once you claim it), with a JWT template and a webhook endpoint",
      removeAt: "the Clerk dashboard, after claiming it; unclaimed apps expire by themselves",
    },
    {
      service: "Convex",
      short: "a Convex project",
      item: `a Convex project named "${slug}" with a cloud dev deployment, in ${answers.convexTeam ? `your Convex team "${answers.convexTeam}"` : "your Convex team"}`,
      removeAt: "the Convex dashboard, in the project's settings",
    },
  ];
  if (answers.secrets === "doppler") {
    created.push({
      service: "Doppler",
      short: "a Doppler project",
      item: `a Doppler project named "${secureFoundationDopplerProject(answers.name)}" with the configs dev and prd, holding the app's secrets${answers.deploy ? ", and two read-only service tokens for its dev config that the template's steps create: github-actions-ci (stored in GitHub as DOPPLER_TOKEN) and vercel-runtime-dev (stored in Vercel)" : ""}`,
      removeAt: "the Doppler dashboard, in the project's settings",
    });
  }
  const { deploy } = answers;
  if (deploy) {
    const doppler = answers.secrets === "doppler";
    created.push(
      {
        service: "GitHub",
        short: "a private GitHub repository",
        item: `a private repository ${deploy.owner}/${deploy.repository}, with this project's code pushed to it${doppler ? ", and a Doppler token stored as its Actions secret DOPPLER_TOKEN" : ""}`,
        removeAt: "the repository's settings on GitHub (Danger Zone)",
      },
      {
        service: "Vercel",
        short: "a Vercel project with a public site",
        item: `a Vercel project named "${deploy.repository}" in the scope "${deploy.vercelScope}", connected to that repository, with ${doppler ? "a Doppler token as DOPPLER_TOKEN on its development, preview and production environments, the only environment variable the setup adds" : "the app's environment variables (its development keys) copied to it"}, and the site published on a public vercel.app address running on the development Clerk and Convex`,
        removeAt: "the project's settings on Vercel",
      },
    );
  }
  return created;
}

// ------------------------------------------------------------------ status

/** The `workKey` of a setup session: how the UI finds it among a project's sessions. */
export const SECURE_FOUNDATION_WORK_KEY = "secure-foundation:setup";

/** What every progress line of the setup session starts with (`report_progress`). */
export const SECURE_FOUNDATION_PROGRESS_PREFIX = "Secure Foundation: ";

/** The progress lines the setup session reports, after the prefix. */
export const SECURE_FOUNDATION_PROGRESS = {
  preflight: "checking this computer",
  installing: "installing",
  running: "running at ",
  stopped: "stopped",
  failed: "failed",
} as const;

/**
 * Where a setup stands. `cloning` is shown while the project is being created (no session
 * yet); the others are derived from the setup session (`secureFoundationStatus`).
 */
export const SecureFoundationPhase = z.enum([
  "cloning",
  "preparing",
  "installing",
  "waiting",
  "running",
  "stopped",
  "failed",
]);
export type SecureFoundationPhase = z.infer<typeof SecureFoundationPhase>;

export interface SecureFoundationStatus {
  phase: SecureFoundationPhase;
  /** The service's local URL while `running`; null otherwise. */
  url: string | null;
}

/** A URL on this computer (`http://localhost:3000`), the only kind the status links to. */
const LOCAL_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/[^\s]*)?$/;

/** True for a setup session (`SECURE_FOUNDATION_WORK_KEY`). */
export function isSecureFoundationSetup(session: Pick<Session, "workKey">): boolean {
  return session.workKey === SECURE_FOUNDATION_WORK_KEY;
}

// ------------------------------------------------------------------- quiet

/**
 * The autonomy mode a new Secure Foundation project is created in. `manual`: the person drives
 * every session, so nothing but the setup session they pressed Go for starts in it.
 */
export const SECURE_FOUNDATION_PROJECT_MODE: AutonomyMode = "manual";

/** The mode the person switches to when they turn automatic work on. */
export const SECURE_FOUNDATION_OPT_IN_MODE: AutonomyMode = "assisted";

/**
 * Whether a project is a quiet Secure Foundation project: one Secure Foundation set up (it has
 * a setup session among `sessions`, the project's own, archived ones included) that is still in
 * the mode it was created in. In a quiet project nothing starts by itself: scheduled and event
 * automations and issue triage don't run (what Manual mode means for every project), and no
 * pull request, issue, review or session update wakes its project manager; those updates wait
 * for the manager's next turn. The person turns automatic work on by changing the project's
 * autonomy mode, and off again by changing it back.
 */
export function isSecureFoundationQuiet(
  project: Pick<Project, "autonomyMode">,
  sessions: ReadonlyArray<Pick<Session, "workKey">>,
): boolean {
  return (
    project.autonomyMode === SECURE_FOUNDATION_PROJECT_MODE &&
    sessions.some(isSecureFoundationSetup)
  );
}

/**
 * `GET /api/secure-foundation/projects/:id/quiet`: whether the project is a quiet Secure
 * Foundation project, answered from the server's own sessions. The snapshot drops a setup
 * session some time after it is archived, so the project page asks when it has none to go by.
 */
export const SecureFoundationQuiet = z.object({ quiet: z.boolean() });
export type SecureFoundationQuiet = z.infer<typeof SecureFoundationQuiet>;

/**
 * A setup's status, from its session alone: the session's lifecycle and the last progress line
 * it reported. The service lives in the session's processes, so a session that ended (or was
 * archived) reads `stopped` whatever it reported last. A session between turns that reported
 * nothing reads `waiting`: it has something to say that the person should read.
 */
export function secureFoundationStatus(
  session: Pick<Session, "status" | "progress" | "archivedAt" | "startError">,
): SecureFoundationStatus {
  const text = session.progress?.text ?? "";
  const line = text.startsWith(SECURE_FOUNDATION_PROGRESS_PREFIX)
    ? text.slice(SECURE_FOUNDATION_PROGRESS_PREFIX.length).trim()
    : "";
  const marks = SECURE_FOUNDATION_PROGRESS;
  const phase = (p: SecureFoundationPhase, url: string | null = null) => ({ phase: p, url });
  if (session.status === "failed" || session.startError || line.startsWith(marks.failed)) {
    return phase("failed");
  }
  const ended = ["completed", "stopped", "interrupted"].includes(session.status);
  if (ended || session.archivedAt || line.startsWith(marks.stopped)) return phase("stopped");
  if (session.status === "waiting") return phase("waiting");
  if (line.startsWith(marks.running)) {
    const url = line.slice(marks.running.length).trim().split(/\s/, 1)[0] ?? "";
    return phase("running", LOCAL_URL.test(url) ? url : null);
  }
  if (line.startsWith(marks.installing)) return phase("installing");
  if (session.status === "idle" && !line) return phase("waiting");
  return phase("preparing");
}
