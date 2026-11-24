import { z } from "zod";
import { Id } from "./common";

/**
 * The sign-in checks of the Secure Foundation form (the service rows of its verification view): for each service the chosen options
 * need, whether this computer is signed in, and a way to start that service's own CLI login.
 * Routes: `/api/secure-foundation/connections`, this computer only. CodeHarden reads and stores
 * no token: each CLI keeps its own sign-in, and "signed in" is what the CLI answers.
 */

/**
 * A service whose own CLI holds a sign-in on this computer. The install signs in to the first
 * four; `clerk` is asked by the requirements page only (the install creates its Clerk app
 * without an account), so it is never one of `secureFoundationServices`.
 */
export const SecureFoundationService = z.enum(["convex", "doppler", "github", "vercel", "clerk"]);
export type SecureFoundationService = z.infer<typeof SecureFoundationService>;

/**
 * The npm packages run with `npx` for the sign-in checks, pinned to a version (never
 * "latest", never from the template or the form). Convex's is the version the template locks.
 */
export const SECURE_FOUNDATION_NPX_PACKAGES = {
  convex: "convex@1.43.0",
  vercel: "vercel@66.6.0",
  // Clerk's official CLI; this version has `whoami --json`.
  clerk: "clerk@4.4.0",
} as const;

/** The GitHub permissions the template's deploy route checks for. */
export const SECURE_FOUNDATION_GITHUB_SCOPES = ["repo", "workflow", "read:org"] as const;

/** A Convex team slug, as `--team` takes it. */
export const ConvexTeamSlug = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);

/** A team of the signed-in Convex account. Personal data: shown to the person only. */
export const ConvexTeam = z.object({ name: z.string().max(200), slug: ConvexTeamSlug });
export type ConvexTeam = z.infer<typeof ConvexTeam>;

/** One service's state on this computer. */
export const SecureFoundationConnection = z.object({
  service: SecureFoundationService,
  /** `missing`: the CLI isn't installed, so nothing can be asked or started. */
  cli: z.enum(["ready", "missing"]),
  /** What the CLI answered; null when it couldn't be asked (missing, timed out, offline). */
  signedIn: z.boolean().nullable(),
  /** One line for the person. */
  message: z.string(),
  /** With a missing CLI: the install command for the person to run themselves. */
  install: z.string().nullable(),
  /** Convex: the account's teams (several means a choice). Empty for other services. */
  teams: z.array(ConvexTeam).default([]),
  /** GitHub and Vercel: the signed-in account's name. Personal data, as the lists below. */
  account: z.string().nullable().default(null),
  /** GitHub: who can own the new repository: the account first, then its organisations. */
  owners: z.array(z.string()).default([]),
  /**
   * GitHub: the owner chosen for the last deploy this app set up, while it is still one of
   * `owners`; the form preselects it. Null: none kept, so the account is preselected.
   */
  lastOwner: z.string().nullable().default(null),
  /** GitHub: permissions the deploy needs that the sign-in lacks. */
  missingScopes: z.array(z.string()).default([]),
  /** Vercel: the teams a project can be created in. */
  scopes: z.array(z.object({ slug: z.string(), name: z.string() })).default([]),
});
export type SecureFoundationConnection = z.infer<typeof SecureFoundationConnection>;

/** `GET /api/secure-foundation/connections?services=convex,doppler`. */
export const SecureFoundationConnectionsQuery = z.object({
  services: z
    .string()
    .transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(SecureFoundationService).min(1).max(8)),
});
export const SecureFoundationConnections = z.object({
  connections: z.array(SecureFoundationConnection),
});
export type SecureFoundationConnections = z.infer<typeof SecureFoundationConnections>;

/**
 * Where a login stands: `starting` (the CLI runs, nothing to show yet), `waiting` (it printed
 * its link: the person finishes in a browser), then `done`, `failed`, `cancelled` or
 * `timed_out`. After any of the last four no process is left.
 */
export const SecureFoundationLoginStatus = z.enum([
  "starting",
  "waiting",
  "done",
  "failed",
  "cancelled",
  "timed_out",
]);
export type SecureFoundationLoginStatus = z.infer<typeof SecureFoundationLoginStatus>;

/**
 * A login started from the form (`POST …/connections/:service/login`, then
 * `GET …/connections/logins/:id`, `DELETE` to cancel). The link and the code are for the person
 * who started it: they are answered to that request only and written nowhere.
 */
export const SecureFoundationLogin = z.object({
  id: Id,
  service: SecureFoundationService,
  status: SecureFoundationLoginStatus,
  /** The service's own sign-in page, once the CLI printed it. */
  url: z.string().nullable(),
  /** The code that page shows or asks for, when the CLI printed one. */
  code: z.string().nullable(),
  /** One line for the person. */
  message: z.string(),
});
export type SecureFoundationLogin = z.infer<typeof SecureFoundationLogin>;

/** True while a login's process may still be running. */
export function isLoginRunning(login: Pick<SecureFoundationLogin, "status">): boolean {
  return login.status === "starting" || login.status === "waiting";
}
