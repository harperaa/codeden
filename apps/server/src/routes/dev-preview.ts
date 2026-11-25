import {
  DevPreviewLimits,
  type DevPreviewLimitsView,
  type DevPreviewLog,
  DevPreviewLogQuery,
  type DevPreviewProject,
  type DevPreviewServerList,
  type DevPreviewServersStopped,
  type DevPreviewState,
  type DevPreviewStopAll,
  SetDevPreviewPmRequest,
  SetDevPreviewRequest,
  StopDevPreviewServersRequest,
} from "@codeden/contracts";
import { type Context, Hono } from "hono";
import { isRemoteRequest } from "../security";
import type { AppServices } from "../services/container";
import { forbidden } from "../services/errors";
import { jsonBody, queryOf } from "./validate";

/**
 * `/api/dev-preview` (`docs/dev-preview.md`). Behind the same sign-in as every other route.
 *
 * Whatever chooses a command or starts a process is answered on this computer only: setting
 * or removing a project's commands, the limits, starting a session's preview, switching the
 * PM thread's preview on and updating it. Another device sees the state, the link and the
 * log, and can stop previews; the Dev Servers page's routes (`/servers`, `/servers/stop`, `/servers/stop-all`) only
 * list and stop, so another device may use both. No agent can reach any of it: `/api` takes the install token or
 * a person's sign-in, never a session's MCP token.
 */
function requireLocal(c: Context): void {
  if (isRemoteRequest(c)) {
    throw forbidden(
      "Dev previews can only be set up and started on the computer running the app.",
      "this_computer_only",
    );
  }
}

export function devPreviewRoutes(s: AppServices) {
  const dp = s.devPreview;
  return new Hono()
    .get("/limits", (c) => c.json<DevPreviewLimitsView>(dp.limits(isRemoteRequest(c))))
    .put("/limits", jsonBody(DevPreviewLimits), (c) => {
      requireLocal(c);
      return c.json<DevPreviewLimitsView>(dp.setLimits(c.req.valid("json")));
    })
    .get("/log", queryOf(DevPreviewLogQuery), (c) =>
      c.json<DevPreviewLog>(dp.log(c.req.valid("query").key)),
    )
    .post("/stop-all", async (c) => c.json<DevPreviewStopAll>(await dp.stopAll()))
    .get("/servers", (c) => c.json<DevPreviewServerList>(dp.servers.list(isRemoteRequest(c))))
    .post("/servers/stop", jsonBody(StopDevPreviewServersRequest), async (c) =>
      c.json<DevPreviewServersStopped>(await dp.servers.stop(c.req.valid("json").keys)),
    )
    .post("/servers/stop-all", async (c) =>
      c.json<DevPreviewServersStopped>(await dp.servers.switchAllOff()),
    )
    .get("/projects/:id", (c) =>
      c.json<DevPreviewProject>(dp.project(c.req.param("id"), isRemoteRequest(c))),
    )
    .put("/projects/:id", jsonBody(SetDevPreviewRequest), async (c) => {
      requireLocal(c);
      const { confirm: _confirmed, ...settings } = c.req.valid("json");
      return c.json<DevPreviewProject>(await dp.setProject(c.req.param("id"), settings));
    })
    .delete("/projects/:id", async (c) => {
      requireLocal(c);
      return c.json<DevPreviewProject>(await dp.removeProject(c.req.param("id")));
    })
    .get("/projects/:id/base", (c) =>
      c.json<DevPreviewState>(dp.baseState(c.req.param("id"), isRemoteRequest(c))),
    )
    .put("/projects/:id/pm", jsonBody(SetDevPreviewPmRequest), async (c) => {
      const { enabled } = c.req.valid("json");
      // Switching it off only stops a process; switching it on starts one.
      if (enabled) requireLocal(c);
      const state = await dp.setPm(c.req.param("id"), enabled);
      return c.json<DevPreviewState>({ ...state, remote: isRemoteRequest(c) });
    })
    .post("/projects/:id/base/update", async (c) => {
      requireLocal(c);
      return c.json<DevPreviewState>(await dp.updateBase(c.req.param("id")));
    })
    .get("/sessions/:id", (c) =>
      c.json<DevPreviewState>(dp.sessionState(c.req.param("id"), isRemoteRequest(c))),
    )
    .post("/sessions/:id/start", async (c) => {
      requireLocal(c);
      return c.json<DevPreviewState>(await dp.startSession(c.req.param("id")));
    })
    .post("/sessions/:id/stop", async (c) => {
      const state = await dp.stopSession(c.req.param("id"));
      return c.json<DevPreviewState>({ ...state, remote: isRemoteRequest(c) });
    });
}
