import { z } from "zod";
import {
  CreateSecureFoundationRequest,
  type SecureFoundationCreated,
  SecureFoundationTemplate,
} from "./secure-foundation";

/**
 * What "Go" checks before anything is created (`POST /api/secure-foundation/verify`), and the
 * line the form shows above its buttons. The sign-in checks are not here: they are the
 * Connections routes, which answer on the computer running the app only.
 */

/**
 * The form as it stands, checked by the server instead of trusted: every field may still be
 * wrong, so nothing here is narrower than a bounded string. No field names a URL or a path.
 */
export const VerifySecureFoundationRequest = z.object({
  name: z.string().max(200),
  adminEmail: z.string().max(400),
  secrets: z.string().max(40).optional(),
  shell: z.string().max(40).optional(),
  modules: z.array(z.string().max(100)).max(50).default([]),
  provider: z.string().max(200),
  /** Present when the deploy option is ticked; its parts may still be missing. */
  deploy: z
    .object({
      owner: z.string().max(200).optional(),
      repository: z.string().max(200).optional(),
      vercelScope: z.string().max(200).optional(),
    })
    .optional(),
});
export type VerifySecureFoundationRequest = z.infer<typeof VerifySecureFoundationRequest>;
export type VerifySecureFoundationRequestInit = z.input<typeof VerifySecureFoundationRequest>;

/** The answers `create` takes, without the commit and the choices made from the sign-ins. */
export const SecureFoundationAnswers = CreateSecureFoundationRequest.omit({
  commit: true,
  convexTeam: true,
  deploy: true,
});

/** The server's checks, in the order they are made and shown. */
export const SecureFoundationCheckId = z.enum(["fields", "folder", "template", "provider"]);
export type SecureFoundationCheckId = z.infer<typeof SecureFoundationCheckId>;

/** `passed`, `needs_you` (the person can put it right where it is shown) or `failed`. */
export const SecureFoundationCheckStatus = z.enum(["passed", "needs_you", "failed"]);
export type SecureFoundationCheckStatus = z.infer<typeof SecureFoundationCheckStatus>;

/** One check: what was found, and what to do about it when it didn't pass. */
export const SecureFoundationCheck = z.object({
  id: SecureFoundationCheckId,
  status: SecureFoundationCheckStatus,
  /** What was found, as one sentence. Nothing personal: never the email. */
  message: z.string(),
  /** What the person does about it; null when it passed. */
  fix: z.string().nullable(),
});
export type SecureFoundationCheck = z.infer<typeof SecureFoundationCheck>;

/**
 * `POST /api/secure-foundation/verify` response: every check, whether or not an earlier one
 * failed, and the commit the template's branch points at now (null when it couldn't be
 * resolved). Verifying creates nothing and writes nothing.
 */
export const VerifySecureFoundationResponse = z.object({
  checks: z.array(SecureFoundationCheck),
  template: SecureFoundationTemplate.nullable(),
});
export type VerifySecureFoundationResponse = z.infer<typeof VerifySecureFoundationResponse>;

/** "a, b and c". */
function listed(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The one line that names what a setup creates in the person's accounts, from the list
 * `secureFoundationCreates` gives: "Creates a Clerk app, a Convex project and a Doppler project
 * in your accounts."
 */
export function secureFoundationCreatesLine(created: SecureFoundationCreated[]): string {
  return `Creates ${listed(created.map((c) => c.short))} in your accounts.`;
}
