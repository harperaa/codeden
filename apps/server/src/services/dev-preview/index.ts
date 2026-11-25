import type { HomePaths } from "../../paths";
import type { Exec } from "../exec";
import type { ProjectService } from "../projects/project-service";
import { isRemoteRunner, type RunnerRouter } from "../runner-port";
import type { SessionRepo } from "../sessions/repo";
import { type DevPreviewDeps, DevPreviewService } from "./dev-preview-service";
import { DevPreviewStore } from "./store";

export { DevPreviewService } from "./dev-preview-service";

/**
 * The dev preview over the server's own projects and sessions. It reads them and starts
 * processes of its own; it never changes a project or a session.
 */
export function createDevPreview(deps: {
  paths: Pick<HomePaths, "home">;
  exec: Exec;
  projects: Pick<ProjectService, "get">;
  sessions: Pick<SessionRepo, "find">;
  runners: Pick<RunnerRouter, "forSession">;
  log?: (message: string) => void;
  /** Test seams (`DevPreviewDeps`). */
  overrides?: Partial<DevPreviewDeps>;
}): DevPreviewService {
  return new DevPreviewService({
    home: deps.paths.home,
    store: new DevPreviewStore(deps.paths.home),
    project: (id) => deps.projects.get(id),
    session: (id) => deps.sessions.find(id)?.session,
    sandboxed: (sessionId) => isRemoteRunner(deps.runners.forSession(sessionId)),
    exec: deps.exec,
    log: deps.log,
    ...deps.overrides,
  });
}
