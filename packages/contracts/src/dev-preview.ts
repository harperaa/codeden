import { z } from "zod";
import { Id, Timestamp } from "./common";

/**
 * Dev preview (`docs/dev-preview.md`): the app starts a project's dev server in a session's
 * worktree, or in a checkout of the project's base branch for the PM thread, on free loopback
 * ports, and shows its URL at the top of the thread.
 *
 * The commands are typed by a person in the project's settings and confirmed there. They are
 * never read from the repository, and no agent tool sets them or starts a preview.
 */

/** Longest dev or prepare command. */
export const DEV_PREVIEW_COMMAND_MAX = 2000;
/** Most ports one preview is given. */
export const DEV_PREVIEW_MAX_PORTS = 4;
/** The variable that gets the first port unless the project names others. */
export const DEV_PREVIEW_DEFAULT_PORT_VAR = "PORT";
/** Lines of output a preview keeps for its log. */
export const DEV_PREVIEW_LOG_LINES = 2000;
/** Lines of the log shown with a failed or stopped preview. */
export const DEV_PREVIEW_TAIL_LINES = 12;

/**
 * Ports no preview is ever given or linked to, whatever the range says: upstream CodeDen's
 * default and CodeHarden's own, and the ports the two products' `pnpm dev` uses (server and
 * web app, first and second copy). The running server's port and the install's default port
 * are added by the server (`harden-channel.ts`).
 */
export const DEV_PREVIEW_RESERVED_PORTS: readonly number[] = [4317, 4417, 4318, 4319, 5173, 5174];

/**
 * An environment variable name a port is passed in. Only names of this one shape are taken:
 * upper case, starting with a letter, with `PORT` in them (`PORT`, `WEB_PORT`, `VITE_PORT`,
 * `PORT_API`). Being a list of what is allowed, not of what is refused, it keeps out every
 * variable a shell, a loader or a runtime reads to decide what to run, known or not.
 */
export const DevPreviewPortVar = z
  .string()
  .max(64)
  .regex(/^(?=[A-Z])[A-Z0-9_]*PORT[A-Z0-9_]*$/, {
    message: "A port variable is upper case and has PORT in its name, like PORT or WEB_PORT",
  });

const Command = z.string().trim().min(1).max(DEV_PREVIEW_COMMAND_MAX);

/**
 * A URL pattern: a regular expression matched against each line the dev command prints. Its
 * first capture group (or the whole match) is the URL. Only `http://localhost`, `127.0.0.1` and
 * `[::1]` URLs are ever shown, whatever the pattern matches.
 */
export const DevPreviewUrlPattern = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (source) => {
      try {
        new RegExp(source);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Not a valid regular expression" },
  );

/** What a person sets for a project. Stored only after they confirmed it. */
export const DevPreviewSettings = z.object({
  /**
   * The command that starts the dev server, run by the person's shell in the worktree. May
   * contain `{port}` (the first port) and `{port2}`, `{port3}`, `{port4}`.
   */
  command: Command,
  /**
   * A command run before the first start in a worktree and again when its lockfile changes,
   * e.g. `pnpm install --frozen-lockfile`. Null for none.
   */
  prepareCommand: Command.nullable().default(null),
  /** The variables the ports are passed in, in order. The first port is the one linked. */
  portVars: z
    .array(DevPreviewPortVar)
    .min(1)
    .max(DEV_PREVIEW_MAX_PORTS)
    .default([DEV_PREVIEW_DEFAULT_PORT_VAR]),
  /**
   * Where the link comes from. `port`: `http://localhost:<first port>`. `output`: the first
   * local URL the command prints (for dev servers that choose their own port).
   */
  urlFrom: z.enum(["port", "output"]).default("port"),
  /** With `urlFrom: "output"`, the pattern to match; null takes the first local URL printed. */
  urlPattern: DevPreviewUrlPattern.nullable().default(null),
  /**
   * Run a preview of the base branch for the PM thread. Off unless a person switched it on (the
   * switch at the top of the PM thread, or "On the PM thread" in the settings): no preview
   * starts by itself for a project that never chose it.
   */
  pmEnabled: z.boolean().default(false),
});
export type DevPreviewSettings = z.infer<typeof DevPreviewSettings>;

/** A project's stored, confirmed settings. */
export const DevPreviewConfig = DevPreviewSettings.extend({
  /** When a person confirmed these commands on this computer. */
  confirmedAt: Timestamp,
  /**
   * The project's base branch when the person confirmed, which is the branch the PM thread's
   * preview follows. The server records it; no request sets it. A project's base branch can be
   * changed by others than the person at this computer (the orchestrator, another device), so
   * when it no longer matches, the PM thread's preview stops until the settings are confirmed
   * again: nobody else gets to pick the code a confirmed command runs unattended.
   */
  baseBranch: z.string().nullable().default(null),
});
export type DevPreviewConfig = z.infer<typeof DevPreviewConfig>;

/**
 * `PUT /api/dev-preview/projects/:id`. `confirm` must be `true`: the UI sends it only from the
 * dialog that shows the exact commands. Refused from another device.
 */
export const SetDevPreviewRequest = DevPreviewSettings.extend({
  confirm: z.literal(true),
});
export type SetDevPreviewRequest = z.infer<typeof SetDevPreviewRequest>;

/** `PUT /api/dev-preview/projects/:id/pm`: the PM thread's preview, on or off. */
export const SetDevPreviewPmRequest = z.object({ enabled: z.boolean() });
export type SetDevPreviewPmRequest = z.infer<typeof SetDevPreviewPmRequest>;

/** How many previews may run, and the ports they are given. App-wide. */
export const DevPreviewLimits = z
  .object({
    /** Previews running at once in one project (the PM thread's included). */
    perProject: z.int().min(1).max(20).default(3),
    /** Previews running at once in all projects. */
    total: z.int().min(1).max(50).default(6),
    /** First port of the range previews are given ports from. */
    portFrom: z.int().min(1024).max(65535).default(43100),
    /** Last port of the range. */
    portTo: z.int().min(1024).max(65535).default(43199),
  })
  .refine((l) => l.portTo - l.portFrom >= DEV_PREVIEW_MAX_PORTS * 2 - 1, {
    message: `The port range needs at least ${DEV_PREVIEW_MAX_PORTS * 2} ports`,
    path: ["portTo"],
  });
export type DevPreviewLimits = z.infer<typeof DevPreviewLimits>;

/** The limits a fresh install has. */
export function defaultDevPreviewLimits(): DevPreviewLimits {
  return DevPreviewLimits.parse({});
}

/** `GET /api/dev-preview/limits`. */
export const DevPreviewLimitsView = z.object({
  limits: DevPreviewLimits,
  /** The caller is another device: the limits are shown read-only there. */
  remote: z.boolean(),
});
export type DevPreviewLimitsView = z.infer<typeof DevPreviewLimitsView>;

/**
 * Settings the app knows to work for a project it recognised, offered to fill the whole form.
 * The values are the app's own constants (`dev-preview-recommended.ts`), never text from the
 * repository, and they are stored or run only when the person saves and confirms them.
 */
export const DevPreviewRecommended = z.object({
  settings: DevPreviewSettings,
  /** What the project was recognised as, as the form says it: "A CodeHarden checkout". */
  reason: z.string().max(200),
});
export type DevPreviewRecommended = z.infer<typeof DevPreviewRecommended>;

/** `GET /api/dev-preview/projects/:id`: what the project's settings show. */
export const DevPreviewProject = z.object({
  projectId: Id,
  /** Null until a person confirmed a dev command. Nothing runs before that. */
  config: DevPreviewConfig.nullable(),
  /**
   * A dev command the app noticed in the project folder (a `dev` script), offered to prefill
   * the form. It is never stored or run unless the person saves and confirms it.
   */
  suggestion: z.object({ command: z.string(), reason: z.string() }).nullable(),
  /**
   * Whole settings for a project the app recognised (a checkout of its own repository). Sent
   * with stored settings too, so the form can say when those can't work. Null for any other
   * project and for another device.
   */
  recommended: DevPreviewRecommended.nullable().default(null),
  /** The project's base branch, which the PM thread's preview follows. Null when unknown. */
  baseBranch: z.string().nullable(),
  /** Something to tell the person after a change (a checkout that was kept, and why). */
  notice: z.string().nullable().default(null),
  /** The caller is another device: commands can't be set or previews started from it. */
  remote: z.boolean(),
});
export type DevPreviewProject = z.infer<typeof DevPreviewProject>;

/**
 * - `off`: not asked for.
 * - `preparing`: the prepare command is running.
 * - `starting`: the dev command runs, nothing is listening yet.
 * - `running`: something is listening; `url` is set.
 * - `stopped`: it ran and ended, or the app stopped it; `message` says why.
 * - `failed`: it never came up; `message` and `logTail` say why.
 */
export const DevPreviewStatus = z.enum([
  "off",
  "preparing",
  "starting",
  "running",
  "stopped",
  "failed",
]);
export type DevPreviewStatus = z.infer<typeof DevPreviewStatus>;

/** The checkout the PM thread's preview runs from. */
export const DevPreviewBase = z.object({
  branch: z.string(),
  /** The commit checked out, abbreviated. Null before the first checkout. */
  commit: z.string().nullable(),
  /** When the app last looked for new commits. */
  checkedAt: Timestamp.nullable(),
  /** The checkout can't be fast-forwarded; `message` on the state says why. */
  blocked: z.boolean(),
});
export type DevPreviewBase = z.infer<typeof DevPreviewBase>;

/** One preview, as the top of a thread shows it. */
export const DevPreviewState = z.object({
  /** `session:<id>` or `base:<projectId>`. */
  key: z.string(),
  kind: z.enum(["session", "base"]),
  projectId: Id,
  sessionId: Id.nullable(),
  status: DevPreviewStatus,
  /**
   * A person asked for it: a session's preview that was started and not switched off, or the
   * PM thread's preview while it is on for the project. It can be on and stopped or failed.
   */
  enabled: z.boolean(),
  /** Set while `running`: a `http://localhost:<port>` link something answers on. */
  url: z.string().nullable(),
  /** The ports given to the dev command, in the order of the project's variables. */
  ports: z.array(z.int()),
  /** Why it is stopped or failed, or a notice (restarted once, stopped to make room). */
  message: z.string().nullable(),
  /** The last lines of the log, with `failed` and `stopped`. Like terminal output: may hold
   * what the project prints. */
  logTail: z.array(z.string()),
  startedAt: Timestamp.nullable(),
  /** The project has a confirmed dev command. */
  configured: z.boolean(),
  /** Why a preview can't be started here (no worktree, a stopped session); null when it can. */
  unavailable: z.string().nullable(),
  /** The caller is another device: it sees the state but can't start a preview. */
  remote: z.boolean(),
  /** Only on the PM thread's preview. */
  base: DevPreviewBase.nullable(),
});
export type DevPreviewState = z.infer<typeof DevPreviewState>;

/** `GET /api/dev-preview/log?key=`. */
export const DevPreviewLogQuery = z.object({ key: z.string().min(1).max(200) });
export const DevPreviewLog = z.object({
  key: z.string(),
  /** The kept output, oldest first, prepare and dev command alike. */
  lines: z.array(z.string()),
});
export type DevPreviewLog = z.infer<typeof DevPreviewLog>;

/** A preview that couldn't be stopped: which one (`session:<id>` or `base:<projectId>`), and why. */
export const DevPreviewStopFailure = z.object({ key: z.string(), message: z.string() });
export type DevPreviewStopFailure = z.infer<typeof DevPreviewStopFailure>;

/**
 * `POST /api/dev-preview/stop-all`. `stopped` counts the previews that were running and ended;
 * one that couldn't be ended is in `failed` and didn't keep the others from stopping.
 */
export const DevPreviewStopAll = z.object({
  stopped: z.int(),
  failed: z.array(DevPreviewStopFailure).default([]),
});
export type DevPreviewStopAll = z.infer<typeof DevPreviewStopAll>;

export const devPreviewSessionKey = (sessionId: string): string => `session:${sessionId}`;
export const devPreviewBaseKey = (projectId: string): string => `base:${projectId}`;

const PLACEHOLDER = /\{port([1-9])?\}/g;

/**
 * How many ports a preview needs: one per variable, and enough for the highest `{portN}` in
 * the command.
 */
export function devPreviewPortCount(settings: Pick<DevPreviewSettings, "command" | "portVars">) {
  let highest = 1;
  for (const match of settings.command.matchAll(PLACEHOLDER)) {
    highest = Math.max(highest, Number(match[1] ?? 1));
  }
  return Math.min(DEV_PREVIEW_MAX_PORTS, Math.max(settings.portVars.length, highest));
}

/**
 * Put the ports into a command: `{port}` and `{port1}` are the first, `{port2}` the second.
 * This is the only substitution there is, and what it writes is always a whole number, so
 * nothing from a request, an agent or the repository can become shell text.
 */
export function expandDevPreviewCommand(command: string, ports: readonly number[]): string {
  return command.replace(PLACEHOLDER, (whole, n: string | undefined) => {
    const port = ports[Number(n ?? 1) - 1];
    return Number.isInteger(port) ? String(port) : whole;
  });
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The URL a preview may link: http or https on this computer, with a port. Anything else a
 * dev server prints (a LAN address, a docs link) is null.
 */
export function localPreviewUrl(text: string): { url: string; port: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!LOCAL_HOSTS.has(parsed.hostname) || parsed.username || parsed.password) return null;
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1) return null;
  return { url: parsed.toString(), port };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colour codes
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ANY_LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{1,5}[^\s"'<>)\]]*/;

/** A line of output without terminal colour and cursor codes. */
export function stripTerminalCodes(text: string): string {
  return text.replace(ANSI, "");
}

/** The local URL in one line of output, by the project's pattern or the first one printed. */
export function previewUrlInLine(
  line: string,
  pattern: string | null,
): { url: string; port: number } | null {
  const text = stripTerminalCodes(line).slice(0, 2000);
  let match: RegExpMatchArray | null;
  try {
    match = text.match(pattern ? new RegExp(pattern) : ANY_LOCAL_URL);
  } catch {
    return null;
  }
  if (!match) return null;
  return localPreviewUrl((match[1] ?? match[0]).trim());
}
