import { z } from "zod";
import { DevPreviewState, DevPreviewStopFailure } from "./dev-preview";

/**
 * The Dev Servers page (`docs/dev-preview.md`, "Dev Servers"): every dev preview of every
 * project in one list, to watch and to stop. Nothing here starts a preview or names a command.
 */

/** One row: a preview's state, and the names of what it belongs to. */
export const DevPreviewServer = z.object({
  /** As the strip on the owning page gets it, without the log's last lines. */
  state: DevPreviewState,
  projectName: z.string(),
  /** The session's title (or its purpose). Null for the PM thread's preview. */
  sessionTitle: z.string().nullable(),
});
export type DevPreviewServer = z.infer<typeof DevPreviewServer>;

/**
 * `GET /api/dev-preview/servers`: the previews that are coming up, running, stopped or failed,
 * in the page's order (`sortDevPreviewServers`). One that is simply off is not in it.
 */
export const DevPreviewServerList = z.object({
  servers: z.array(DevPreviewServer),
  /** The caller is another device: it can stop a preview, but not start one or open its link. */
  remote: z.boolean(),
});
export type DevPreviewServerList = z.infer<typeof DevPreviewServerList>;

/** `POST /api/dev-preview/servers/stop`: the previews to switch off, by their keys. */
export const StopDevPreviewServersRequest = z.object({
  keys: z.array(z.string().min(1).max(200)).min(1).max(200),
});
export type StopDevPreviewServersRequest = z.infer<typeof StopDevPreviewServersRequest>;

/** The answer: each preview was switched off, or it is in `failed` with the reason. */
export const DevPreviewServersStopped = z.object({
  /** The keys that are off now (also one that was off already). */
  stopped: z.array(z.string()),
  failed: z.array(DevPreviewStopFailure),
});
export type DevPreviewServersStopped = z.infer<typeof DevPreviewServersStopped>;

const RANK: Record<DevPreviewState["status"], number> = {
  running: 0,
  preparing: 1,
  starting: 1,
  failed: 2,
  stopped: 2,
  off: 3,
};

/**
 * The page's order: running first, then the ones coming up, then failed and stopped; within
 * that by project, the PM thread's preview before the sessions'.
 */
export function sortDevPreviewServers(servers: readonly DevPreviewServer[]): DevPreviewServer[] {
  const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...servers].sort(
    (a, b) =>
      RANK[a.state.status] - RANK[b.state.status] ||
      text(a.projectName.toLowerCase(), b.projectName.toLowerCase()) ||
      text(a.state.projectId, b.state.projectId) ||
      Number(a.state.kind === "session") - Number(b.state.kind === "session") ||
      text((a.sessionTitle ?? "").toLowerCase(), (b.sessionTitle ?? "").toLowerCase()) ||
      text(a.state.key, b.state.key),
  );
}
