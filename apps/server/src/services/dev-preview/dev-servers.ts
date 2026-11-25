import {
  type DevPreviewServer,
  type DevPreviewServerList,
  type DevPreviewServersStopped,
  type DevPreviewState,
  type DevPreviewStopAll,
  type DevPreviewStopFailure,
  type Project,
  type Session,
  sortDevPreviewServers,
} from "@codeden/contracts";
import { errorMessage, ServiceError } from "../errors";
import type { Preview } from "./preview";

/** What the list and the stops need from the service: its previews and its own off paths. */
export interface DevServersHost {
  /** Every preview the service holds, whatever its state. */
  previews: () => Preview[];
  baseState: (projectId: string, remote: boolean) => DevPreviewState;
  sessionState: (sessionId: string, remote: boolean) => DevPreviewState;
  project: (id: string) => Project | undefined;
  session: (id: string) => Session | undefined;
  /** A session's preview off, as its own switch does it. */
  stopSession: (sessionId: string) => Promise<unknown>;
  /** The PM thread's preview off, as its own switch does it: the choice is kept. */
  switchPmOff: (projectId: string) => Promise<unknown>;
  /** The PM threads' previews stay stopped until a person starts them again. */
  holdBases: () => void;
  /** Starts that wait for their turn are given up. */
  cancelPending: () => void;
}

const SESSION = "session:";
const BASE = "base:";

/**
 * The Dev Servers page's side of the service (`docs/dev-preview.md`, "Dev Servers"): one list
 * of every preview that isn't simply off, and stopping them.
 *
 * Nothing here ends a process itself or starts one. A stop is the off path the owning page's
 * switch uses, per preview, also for the page's Stop all (`switchAllOff`); Settings' Stop all
 * (`stopAll`) holds the PM threads' previews instead. All of them end a preview's processes
 * through `Preview.stop` alone.
 */
export class DevServers {
  constructor(private readonly host: DevServersHost) {}

  list(remote: boolean): DevPreviewServerList {
    const servers: DevPreviewServer[] = [];
    for (const preview of this.host.previews()) {
      if (preview.status === "off") continue;
      const { kind, projectId, sessionId } = preview.target;
      let state: DevPreviewState;
      try {
        state =
          kind === "session" && sessionId
            ? this.host.sessionState(sessionId, remote)
            : this.host.baseState(projectId, remote);
      } catch {
        // Its project or session is gone; the next tick stops and forgets it.
        continue;
      }
      const session = sessionId ? this.host.session(sessionId) : undefined;
      servers.push({
        // The log's last lines are the project's own output: they stay with the log viewer.
        state: { ...state, logTail: [] },
        projectName: this.host.project(projectId)?.name ?? projectId,
        sessionTitle: session ? (session.title ?? session.purpose) : null,
      });
    }
    return { servers: sortDevPreviewServers(servers), remote };
  }

  /**
   * Switch these previews off, each the way its own page does. They are stopped side by side:
   * one that fails is reported with its reason and doesn't keep the others from stopping.
   */
  async stop(keys: readonly string[]): Promise<DevPreviewServersStopped> {
    const unique = [...new Set(keys)];
    const results = await Promise.allSettled(unique.map((key) => this.stopOne(key)));
    const answer: DevPreviewServersStopped = { stopped: [], failed: [] };
    results.forEach((result, i) => {
      const key = unique[i] as string;
      if (result.status === "fulfilled") answer.stopped.push(key);
      else answer.failed.push({ key, message: errorMessage(result.reason) });
    });
    return answer;
  }

  /**
   * The page's Stop all: every listed preview is switched off as `stop` does it, the stopped
   * and failed ones too, so every owning page's switch shows off and nothing is held or comes
   * back by itself. Starts that wait for their turn are given up first, so none comes up
   * right after.
   */
  switchAllOff(): Promise<DevPreviewServersStopped> {
    this.host.cancelPending();
    const listed = this.host.previews().filter((p) => p.status !== "off");
    return this.stop(listed.map((p) => p.target.key));
  }

  /**
   * Settings › Dev previews' Stop all: every running preview of every project ends. Unlike the
   * page's (`switchAllOff`), the PM threads' previews keep their switch on: they stay stopped
   * until a person restarts them, or until the app starts again.
   */
  async stopAll(): Promise<DevPreviewStopAll> {
    const running = this.host.previews().filter((p) => p.active);
    // Without this the next look at the base branch would bring each PM preview back.
    this.host.holdBases();
    this.host.cancelPending();
    const results = await Promise.allSettled(
      running.map((p) =>
        p.target.kind === "base"
          ? p.stop("stopped", "Stopped with Stop all. Restart it when you want it back.")
          : p.stop("off"),
      ),
    );
    const failed: DevPreviewStopFailure[] = [];
    results.forEach((result, i) => {
      if (result.status === "fulfilled") return;
      failed.push({
        key: (running[i] as Preview).target.key,
        message: errorMessage(result.reason),
      });
    });
    return { stopped: running.length - failed.length, failed };
  }

  private async stopOne(key: string): Promise<void> {
    if (key.startsWith(SESSION)) {
      try {
        await this.host.stopSession(key.slice(SESSION.length));
      } catch (error) {
        // The session is gone: its preview was stopped before that was noticed.
        if (error instanceof ServiceError && error.status === 404) return;
        throw error;
      }
      return;
    }
    if (key.startsWith(BASE)) {
      await this.host.switchPmOff(key.slice(BASE.length));
      return;
    }
    throw new Error("Not a dev server.");
  }
}
