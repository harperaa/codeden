import { z } from "zod";
import { Timestamp } from "./common";
import { DEV_PREVIEW_DEFAULT_PORT_VAR, DevPreviewSettings } from "./dev-preview";
import { SecureFoundationSecrets, secureFoundationDopplerProject } from "./secure-foundation";

/**
 * The dev preview of a project Secure Foundation set up (`docs/dev-preview.md`, "Secure
 * Foundation projects"): values to fill the dev preview's settings form with, and what the
 * person has to know to make a preview of such a project work.
 *
 * It is a suggestion for a form and nothing more. The dev preview's rule is untouched: a command
 * is stored only when a person confirms it in the settings on this computer. Nothing here writes
 * the dev preview's settings, no route takes a command from Secure Foundation, and nothing is
 * read from the repository: the Doppler names are the ones made from the person's own answer in
 * the setup form (the project's name), kept by the app when the project was created.
 */

/** The Doppler config the template's install pins the project folder to. */
export const SECURE_FOUNDATION_DOPPLER_CONFIG = "dev";

/**
 * A Doppler project or config name that may be written into a command: letters, digits, dots,
 * dashes and underscores, starting with a letter or digit (so it can't be read as an option),
 * 64 characters at most. Nothing a shell gives a meaning to.
 */
const PLAIN_DOPPLER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isPlainDopplerName(value: unknown): value is string {
  return typeof value === "string" && PLAIN_DOPPLER_NAME.test(value);
}

/**
 * What the app keeps about a setup when Secure Foundation created the project: the answers a
 * dev preview depends on. Names only, no secret. Stored in the app's home
 * (`secure-foundation.json`), by project id.
 */
export const SecureFoundationSetupRecord = z.object({
  /** Where the installed app keeps its secrets. */
  secrets: SecureFoundationSecrets,
  /** The Doppler project and config the install uses; null without Doppler. */
  doppler: z.object({ project: z.string().max(200), config: z.string().max(200) }).nullable(),
  createdAt: Timestamp,
});
export type SecureFoundationSetupRecord = z.infer<typeof SecureFoundationSetupRecord>;

/** The record of a setup with these form answers. */
export function secureFoundationSetupRecord(
  answers: { name: string; secrets: SecureFoundationSecrets },
  at: Date,
): SecureFoundationSetupRecord {
  return {
    secrets: answers.secrets,
    doppler:
      answers.secrets === "doppler"
        ? {
            project: secureFoundationDopplerProject(answers.name),
            config: SECURE_FOUNDATION_DOPPLER_CONFIG,
          }
        : null,
    createdAt: at.toISOString(),
  };
}

/**
 * `GET /api/secure-foundation/projects/:id/dev-preview`: what the dev preview's settings form
 * is filled with for this project. Answered on this computer only; another device, and any
 * project Secure Foundation didn't set up, gets `applies: false`.
 */
export const SecureFoundationDevPreview = z.object({
  /** Secure Foundation set this project up. */
  applies: z.boolean(),
  /** The setup's secrets mode; null when the project was made before the app kept it. */
  secrets: SecureFoundationSecrets.nullable(),
  /**
   * The values for the form. Null when none can be offered; `notes` says why. They are shown in
   * the form and stored only by the form's own Save and its confirmation.
   */
  settings: DevPreviewSettings.nullable(),
  /** What the person has to know or do. Text in backticks is a command, a name or a path. */
  notes: z.array(z.string().max(1000)).max(8),
  /** That the Convex dev process runs separately, with its command. Null when it doesn't apply. */
  convex: z.string().max(1000).nullable(),
});
export type SecureFoundationDevPreview = z.infer<typeof SecureFoundationDevPreview>;

/** The answer for another device and for a project Secure Foundation didn't set up. */
export const SECURE_FOUNDATION_NO_DEV_PREVIEW: SecureFoundationDevPreview = {
  applies: false,
  secrets: null,
  settings: null,
  notes: [],
  convex: null,
};

const DOPPLER_BY_HAND =
  "`doppler run --project <your Doppler project> --config <your config> -- npm run dev`";

const SHARED_CONVEX =
  "Every preview of this project uses that one Convex dev deployment, with the Convex functions of the folder the command runs in, not those of a session's worktree.";

/** The fields every Secure Foundation project gets, around its dev command. */
function settingsWith(command: string): DevPreviewSettings {
  return {
    command,
    // A preview's folder is a fresh checkout: it has no `node_modules`.
    prepareCommand: "npm ci",
    portVars: [DEV_PREVIEW_DEFAULT_PORT_VAR],
    // The link is the address `next dev` itself prints, on the port it was given.
    urlFrom: "output",
    urlPattern: null,
    // Off until a person switches it on, like every preview.
    pmEnabled: false,
  };
}

function envLocalNote(baseCheckout: string | null): string {
  const where = baseCheckout
    ? `for the PM thread's preview into its checkout, \`${baseCheckout}\` (it is there once that preview has started)`
    : "for the PM thread's preview into the checkout the app keeps for it";
  return `This project keeps its secrets in \`.env.local\` in the project folder. Git ignores that file, so a preview's folder doesn't have it, and the app starts without its keys until you copy it there yourself: for a session's preview into that session's worktree, ${where}. The app doesn't copy it. Whoever works in that folder, an agent included, can then read it. Start the preview again afterwards.`;
}

/**
 * The form values and notes for a project Secure Foundation set up. `setup` is what the app
 * kept when it created the project, or null for a project made before it kept anything.
 *
 * With Doppler the dev command names the project and the config itself, because Doppler
 * remembers them per folder and a preview runs in another folder than the project's. Each name
 * is written into the command only when it is a plain name (`isPlainDopplerName`); otherwise
 * nothing is offered at all, and the note says why.
 */
export function secureFoundationDevPreview(
  setup: Pick<SecureFoundationSetupRecord, "secrets" | "doppler"> | null,
  opts: { baseCheckout?: string | null } = {},
): SecureFoundationDevPreview {
  const baseCheckout = opts.baseCheckout ?? null;
  if (!setup) {
    return {
      applies: true,
      secrets: null,
      settings: settingsWith("npm run dev"),
      notes: [
        `This project was set up before the app kept where its secrets are, so the dev command is the one for \`.env.local\`. If its secrets are in Doppler, change the dev command to ${DOPPLER_BY_HAND}: Doppler remembers the project and the config per folder, and a preview runs in another folder.`,
        envLocalNote(baseCheckout),
      ],
      convex: `Convex runs separately: the dev command doesn't start it. Keep \`npm run convex\` (with Doppler: \`npm run convex:doppler\`) running in a terminal in the project folder. ${SHARED_CONVEX}`,
    };
  }
  if (setup.secrets === "doppler") {
    const convex = `Convex runs separately: the dev command doesn't start it. Keep \`npm run convex:doppler\` running in a terminal in the project folder; the setup session runs it for as long as its processes live. ${SHARED_CONVEX}`;
    const project = setup.doppler?.project;
    const config = setup.doppler?.config;
    if (!isPlainDopplerName(project) || !isPlainDopplerName(config)) {
      return {
        applies: true,
        secrets: "doppler",
        settings: null,
        notes: [
          `Nothing is filled in: the Doppler project or config name kept for this project isn't a plain name (letters, digits, dots, dashes and underscores, starting with a letter or digit), and only a plain name is put into a command. Type the dev command yourself, ${DOPPLER_BY_HAND}, with \`npm ci\` as the prepare command, \`PORT\` as the port variable and the link from the output.`,
        ],
        convex,
      };
    }
    return {
      applies: true,
      secrets: "doppler",
      settings: settingsWith(`doppler run --project ${project} --config ${config} -- npm run dev`),
      notes: [
        `The dev command names the Doppler project \`${project}\` and the config \`${config}\` itself: Doppler remembers them per folder, and a preview runs in another folder than the project's. The \`doppler\` command has to be on the path the app was started with, and signed in.`,
      ],
      convex,
    };
  }
  return {
    applies: true,
    secrets: "env_local",
    settings: settingsWith("npm run dev"),
    notes: [envLocalNote(baseCheckout)],
    convex: `Convex runs separately: the dev command doesn't start it. Keep \`npm run convex\` running in a terminal in the project folder; the setup session runs it for as long as its processes live. ${SHARED_CONVEX}`,
  };
}
