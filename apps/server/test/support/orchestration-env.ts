import {
  type Project,
  type QueueSender,
  type Session,
  Settings,
  type StartSessionRequest,
  type StartSessionResponse,
  type UserInput,
} from "@codeden/contracts";
import { vi } from "vitest";
import { OrchestrationService } from "../../src/services/orchestration/orchestration-service";
import { ProjectService } from "../../src/services/projects/project-service";
import type { InputDecorator } from "../../src/services/sessions/input-decorator";
import type { SessionService } from "../../src/services/sessions/session-service";
import { sampleSession } from "../helpers";
import { createGithubEnv, type GithubEnv } from "./github-env";

/** The wake scheduler's quiet period here; `syncAndSettle` runs well past it. */
const DEBOUNCE_MS = 50;
/**
 * Where the clock starts: before the fake GitHub's own clock (2026-11-01), so what a test adds
 * there after the first import is newer than the import and reads as opened, not imported.
 */
const START = Date.parse("2026-10-31T12:00:00.000Z");

/**
 * The orchestration service over `createGithubEnv` (a real SQLite database and event log, a fake
 * GitHub) with a scripted session service: a start adds a session row, and a message is recorded
 * as the session would get it (with the status digest and the notices its turn carries, which
 * then count as delivered). No runner, no provider, and the clock is Vitest's: `syncAndSettle`
 * moves it past the wake scheduler's quiet period, so a test reads what a GitHub sync led to
 * without waiting.
 */
export interface OrchestrationEnv {
  github: GithubEnv;
  orchestration: OrchestrationService;
  projects: ProjectService;
  /** Session starts asked for, in order (the PM's among them). */
  starts: StartSessionRequest[];
  /** Messages sent to sessions, in order, with the text the session's turn starts from. */
  messages: Array<{ sessionId: string; text: string; from: string }>;
  /** Change a project the way the product does: a `project.updated` event. */
  updateProject: (id: string, patch: Partial<Project>) => Project;
  /** Read GitHub now, then let the notices and the wake they ask for run. */
  syncAndSettle: (projectId: string) => Promise<void>;
  close: () => Promise<void>;
}

export function createOrchestrationEnv(): OrchestrationEnv {
  vi.useFakeTimers({
    now: START,
    toFake: ["setTimeout", "clearTimeout", "setImmediate", "clearImmediate", "Date"],
  });
  const github = createGithubEnv();
  const { db, store, repo } = github;
  const projects = new ProjectService({
    db: db.db,
    store,
    exec: async () => ({
      code: null,
      stdout: "",
      stderr: "",
      notFound: true,
      timedOut: false,
      path: null,
    }),
    projectsDir: github.dir,
  });
  const starts: StartSessionRequest[] = [];
  const messages: OrchestrationEnv["messages"] = [];
  let decorate: InputDecorator = (_session, input) => ({ input });
  const sessions = {
    setInputDecorator: (fn: InputDecorator) => {
      decorate = fn;
    },
    configuredProvider: () => null,
    isDelivering: () => false,
    // No session here has a queue: a role's first session adopts nothing.
    adoptQueued: () => undefined,
    restoreQueued: () => undefined,
    stopKeepingQueue: async () => [],
    start: async (req: StartSessionRequest): Promise<StartSessionResponse> => {
      starts.push(req);
      const session: Session = {
        ...sampleSession,
        id: `started-${starts.length}`,
        projectId: req.projectId,
        role: req.role,
        startedBy: req.startedBy,
        purpose: req.purpose ?? "work",
        workKey: req.workKey ?? "request:work",
        scope: { projectId: req.projectId },
        title: req.title ?? null,
        autonomy: req.autonomy ?? "auto",
        status: "idle",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      repo.create(session, {
        workspaceMode: "repo_root",
        workspaceFallback: null,
        forced: null,
        queuedBehind: [],
      });
      return { status: "started", sessionId: session.id };
    },
    send: async (sessionId: string, req: { input: UserInput }, from: QueueSender = "user") => {
      const turn = decorate(repo.get(sessionId), req.input, from);
      messages.push({ sessionId, text: turn.input.text, from });
      turn.delivered?.();
      return { status: "sent" };
    },
    stop: async (sessionId: string) => repo.update(sessionId, (s) => ({ ...s, status: "stopped" })),
  } as unknown as SessionService;
  const orchestration = new OrchestrationService({
    db: db.db,
    store,
    repo,
    sessions,
    projects,
    inbox: github.inbox,
    artifacts: github.artifacts,
    // The settings as installed (every role on Auto), and a runner with nothing to switch to.
    settings: { get: () => Settings.parse({}) },
    runner: { isConnected: () => true, providers: () => [] },
    options: { wake: { debounceMs: DEBOUNCE_MS, maxWaitMs: DEBOUNCE_MS * 4 } },
  });
  orchestration.start();
  return {
    github,
    orchestration,
    projects,
    starts,
    messages,
    updateProject: (id, patch) => {
      const next = {
        ...projects.get(id),
        ...patch,
        updatedAt: new Date().toISOString(),
      } as Project;
      store.append([{ type: "project.updated", sessionId: null, payload: { project: next } }]);
      return next;
    },
    syncAndSettle: async (projectId) => {
      await github.service.syncNow(projectId);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 20);
    },
    close: async () => {
      orchestration.stop();
      vi.useRealTimers();
      await github.close();
    },
  };
}
