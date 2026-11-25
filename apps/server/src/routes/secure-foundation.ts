import {
  CreateSecureFoundationRequest,
  type CreateSecureFoundationResponse,
  SECURE_FOUNDATION_NO_DEV_PREVIEW,
  type SecureFoundationConnections,
  SecureFoundationConnectionsQuery,
  type SecureFoundationDevPreview,
  type SecureFoundationFinish,
  type SecureFoundationLogin,
  type SecureFoundationOptions,
  type SecureFoundationPrefill,
  type SecureFoundationQuiet,
  type SecureFoundationRepoSecrets,
  type SecureFoundationRequirements,
  SecureFoundationService,
  type SecureFoundationTemplate,
  VerifySecureFoundationRequest,
  type VerifySecureFoundationResponse,
} from "@codeden/contracts";
import { type Context, Hono } from "hono";
import { isRemoteRequest } from "../security";
import type { AppServices } from "../services/container";
import { forbidden } from "../services/errors";
import { hasSetupSession, holdsPmWakes } from "../services/secure-foundation/quiet";
import { jsonBody, queryOf } from "./validate";

/**
 * `/api/secure-foundation`: the add-project option that creates a project from the build's
 * template and starts its setup session (`docs/secure-foundation.md`). Behind the same sign-in
 * as every other route. What is personal (the suggested email, the Clerk claim link) is only
 * answered on this computer: another device gets nulls, never an error. The Connections routes
 * (sign-in state, starting and cancelling a login) are refused to another device altogether.
 * `/requirements` checks the tools and sign-ins every setup needs, before the form is filled in:
 * found or not, a version number and signed in or not, nothing else; refused to another device.
 * `/verify` is what "Go" checks first (fields, folder, template commit, provider); the sign-in
 * checks are not part of it and stay the Connections routes. `/projects/:id/quiet` says whether
 * automatic work is still off in a project Secure Foundation set up (false for any other id).
 * `/projects/:id/dev-preview` gives the values the dev preview's settings form is filled with
 * for such a project. It is a suggestion, read-only: no route here takes a command, and the dev
 * preview's own settings are written only by its own route, after the person's confirmation.
 * Another device gets nothing to fill in, since commands can't be set from one.
 * `/projects/:id/repository-secrets` lists the repository secrets and variables the project's
 * workflows use and which of them its GitHub repository has: names only, and nothing here sets
 * one or takes a value. On this computer it reads the project's workflow files and asks the
 * person's own `gh`; another device gets the last result, read-only, or nothing.
 * `…/repository-secrets/check` asks again and is refused to another device.
 */
/** Sign-ins read and change this computer's own state and start processes on it. */
function requireLocal(
  c: Context,
  message = "Sign-ins can only be checked and started on the computer running the app.",
): void {
  if (isRemoteRequest(c)) throw forbidden(message);
}

export function secureFoundationRoutes(s: AppServices) {
  const sf = s.secureFoundation;
  const connections = sf.connections;
  return new Hono()
    .get("/connections", queryOf(SecureFoundationConnectionsQuery), async (c) => {
      requireLocal(c);
      return c.json<SecureFoundationConnections>({
        connections: await sf.connectionStates(c.req.valid("query").services),
      });
    })
    .get("/requirements", async (c) => {
      requireLocal(
        c,
        "What Secure Foundation needs can only be checked on the computer running the app.",
      );
      return c.json<SecureFoundationRequirements>(await sf.requirements());
    })
    .post("/connections/:service/login", async (c) => {
      requireLocal(c);
      const service = SecureFoundationService.safeParse(c.req.param("service"));
      if (!service.success) throw forbidden("Unknown service", "unknown_service");
      return c.json<SecureFoundationLogin>(await connections.startLogin(service.data), 201);
    })
    .get("/connections/logins/:id", (c) => {
      requireLocal(c);
      return c.json<SecureFoundationLogin>(connections.login(c.req.param("id")));
    })
    .delete("/connections/logins/:id", (c) => {
      requireLocal(c);
      return c.json<SecureFoundationLogin>(connections.cancel(c.req.param("id")));
    })
    .get("/", async (c) => c.json<SecureFoundationOptions>(await sf.options()))
    .get("/prefill", async (c) =>
      c.json<SecureFoundationPrefill>(
        isRemoteRequest(c) ? { adminEmail: null } : await sf.prefill(),
      ),
    )
    .post("/template", async (c) => c.json<SecureFoundationTemplate>(await sf.template()))
    .post("/verify", jsonBody(VerifySecureFoundationRequest), async (c) =>
      c.json<VerifySecureFoundationResponse>(await sf.verify(c.req.valid("json"))),
    )
    .post("/projects", jsonBody(CreateSecureFoundationRequest), async (c) =>
      c.json<CreateSecureFoundationResponse>(await sf.create(c.req.valid("json")), 201),
    )
    .get("/projects/:id/finish", (c) =>
      c.json<SecureFoundationFinish>(
        isRemoteRequest(c)
          ? { clerkClaimUrl: null, deployedUrl: null }
          : sf.finish(c.req.param("id")),
      ),
    )
    .get("/projects/:id/quiet", (c) =>
      c.json<SecureFoundationQuiet>({ quiet: holdsPmWakes(s, c.req.param("id")) }),
    )
    .get("/projects/:id/repository-secrets", async (c) => {
      const id = c.req.param("id");
      return c.json<SecureFoundationRepoSecrets>(
        await sf.repoSecrets.view(id, {
          local: !isRemoteRequest(c),
          setUp: () => hasSetupSession(s, id),
        }),
      );
    })
    .post("/projects/:id/repository-secrets/check", async (c) => {
      requireLocal(
        c,
        "Repository secrets can only be checked on the computer running the app: it asks that computer's own GitHub sign-in.",
      );
      const id = c.req.param("id");
      return c.json<SecureFoundationRepoSecrets>(
        await sf.repoSecrets.check(id, { setUp: () => hasSetupSession(s, id) }),
      );
    })
    .get("/projects/:id/dev-preview", (c) => {
      if (isRemoteRequest(c)) {
        return c.json<SecureFoundationDevPreview>(SECURE_FOUNDATION_NO_DEV_PREVIEW);
      }
      const id = c.req.param("id");
      return c.json<SecureFoundationDevPreview>(
        sf.devPreview(id, {
          setUp: () => hasSetupSession(s, id),
          baseCheckout: s.devPreview.baseCheckoutPath(id),
        }),
      );
    });
}
