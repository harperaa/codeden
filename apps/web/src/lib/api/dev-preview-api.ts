import {
  type DevPreviewConfig,
  type DevPreviewLimits,
  DevPreviewLimitsView,
  DevPreviewLog,
  DevPreviewProject,
  DevPreviewServerList,
  DevPreviewServersStopped,
  type DevPreviewSettings,
  DevPreviewState,
  DevPreviewStopAll,
  defaultDevPreviewLimits,
  devPreviewBaseKey,
  devPreviewSessionKey,
  sortDevPreviewServers,
} from "@codeden/contracts";
import type { Fetcher } from "./http";

/** Dev previews (`/api/dev-preview`, `docs/dev-preview.md`). */
export interface DevPreviewApi {
  limits(): Promise<DevPreviewLimitsView>;
  /** This computer only. */
  setLimits(limits: DevPreviewLimits): Promise<DevPreviewLimitsView>;
  project(projectId: string): Promise<DevPreviewProject>;
  /**
   * Store the commands a person just confirmed. This computer only. The call sends the
   * confirmation itself, so only call it from the dialog that showed the commands.
   */
  confirmProject(projectId: string, settings: DevPreviewSettings): Promise<DevPreviewProject>;
  /** Forget the project's commands and stop its previews. This computer only. */
  removeProject(projectId: string): Promise<DevPreviewProject>;
  session(sessionId: string): Promise<DevPreviewState>;
  /** This computer only. */
  startSession(sessionId: string): Promise<DevPreviewState>;
  stopSession(sessionId: string): Promise<DevPreviewState>;
  /** The PM thread's preview of the project's base branch. */
  base(projectId: string): Promise<DevPreviewState>;
  /** On (this computer only) or off; the choice is kept. */
  setPm(projectId: string, enabled: boolean): Promise<DevPreviewState>;
  /** Look for new commits on the base branch now. This computer only. */
  updateBase(projectId: string): Promise<DevPreviewState>;
  log(key: string): Promise<DevPreviewLog>;
  stopAll(): Promise<DevPreviewStopAll>;
  /** Every preview of every project that isn't off (the Dev Servers page). */
  servers(): Promise<DevPreviewServerList>;
  /** Switch these previews off, each as its own page's switch does. */
  stopServers(keys: string[]): Promise<DevPreviewServersStopped>;
}

export function httpDevPreviewApi(http: Fetcher): DevPreviewApi {
  const base = "/dev-preview";
  const project = (id: string) => `${base}/projects/${encodeURIComponent(id)}`;
  const session = (id: string) => `${base}/sessions/${encodeURIComponent(id)}`;
  const state = (v: unknown) => DevPreviewState.parse(v);
  const view = (v: unknown) => DevPreviewProject.parse(v);
  const limits = (v: unknown) => DevPreviewLimitsView.parse(v);
  return {
    limits: () => http.get(`${base}/limits`, limits),
    setLimits: (value) => http.call("PUT", `${base}/limits`, value, limits),
    project: (id) => http.get(project(id), view),
    confirmProject: (id, settings) =>
      http.call("PUT", project(id), { ...settings, confirm: true }, view),
    removeProject: (id) => http.call("DELETE", project(id), undefined, view),
    session: (id) => http.get(session(id), state),
    startSession: (id) => http.post(`${session(id)}/start`, {}, state),
    stopSession: (id) => http.post(`${session(id)}/stop`, {}, state),
    base: (id) => http.get(`${project(id)}/base`, state),
    setPm: (id, enabled) => http.call("PUT", `${project(id)}/pm`, { enabled }, state),
    updateBase: (id) => http.post(`${project(id)}/base/update`, {}, state),
    log: (key) =>
      http.get(`${base}/log?key=${encodeURIComponent(key)}`, (v) => DevPreviewLog.parse(v)),
    stopAll: () => http.post(`${base}/stop-all`, {}, (v) => DevPreviewStopAll.parse(v)),
    servers: () => http.get(`${base}/servers`, (v) => DevPreviewServerList.parse(v)),
    stopServers: (keys) =>
      http.post(`${base}/servers/stop`, { keys }, (v) => DevPreviewServersStopped.parse(v)),
  };
}

/**
 * The mock client keeps settings in memory and "runs" a preview at once, so the UI can be
 * worked on without a server. Nothing is started. `world` says which project a session is in
 * and which projects have a `dev` script to suggest a command for (all of them without it).
 */
export function mockDevPreviewApi(
  world: {
    projectOf?: (sessionId: string) => string | null | undefined;
    hasDevScript?: (projectId: string) => boolean;
    /** Names for the Dev Servers page; the ids stand in without them. */
    projectName?: (projectId: string) => string | undefined;
    sessionTitle?: (sessionId: string) => string | undefined;
  } = {},
): DevPreviewApi {
  let limits = defaultDevPreviewLimits();
  const configs = new Map<string, DevPreviewConfig>();
  const running = new Set<string>();
  const since = new Map<string, string>();
  let nextPort = limits.portFrom;
  const ports = new Map<string, number>();
  const state = (key: string, projectId: string, sessionId: string | null): DevPreviewState => {
    const port = ports.get(key);
    const on = running.has(key) && port !== undefined;
    return {
      key,
      kind: sessionId ? "session" : "base",
      projectId,
      sessionId,
      status: on ? "running" : "off",
      enabled: on,
      url: on ? `http://localhost:${port}` : null,
      ports: on ? [port] : [],
      message: null,
      logTail: [],
      startedAt: on ? (since.get(key) ?? null) : null,
      configured: configs.has(projectId),
      unavailable: null,
      remote: false,
      base: sessionId
        ? null
        : { branch: "main", commit: on ? "0123456789" : null, checkedAt: null, blocked: false },
    };
  };
  const view = (projectId: string): DevPreviewProject => ({
    projectId,
    config: configs.get(projectId) ?? null,
    // As the server: still offered for stored settings that have no prepare command.
    suggestion:
      configs.get(projectId)?.prepareCommand || world.hasDevScript?.(projectId) === false
        ? null
        : {
            command: "pnpm dev",
            prepareCommand: "pnpm install --frozen-lockfile",
            reason: "package.json has a dev script",
          },
    recommended: null,
    baseBranch: "main",
    notice: null,
    remote: false,
  });
  const turn = (key: string, on: boolean) => {
    if (on) {
      if (!running.has(key)) since.set(key, new Date().toISOString());
      running.add(key);
      if (!ports.has(key)) ports.set(key, nextPort++);
    } else running.delete(key);
  };
  const SESSION = devPreviewSessionKey("");
  const BASE = devPreviewBaseKey("");
  const switchPmOff = (id: string) => {
    const config = configs.get(id);
    if (config) configs.set(id, { ...config, pmEnabled: false });
    turn(devPreviewBaseKey(id), false);
  };
  const sessionState = (sessionId: string) =>
    state(devPreviewSessionKey(sessionId), world.projectOf?.(sessionId) ?? "p-mock", sessionId);
  return {
    limits: async () => ({ limits, remote: false }),
    setLimits: async (value) => {
      limits = value;
      return { limits, remote: false };
    },
    project: async (id) => view(id),
    confirmProject: async (id, settings) => {
      configs.set(id, { ...settings, confirmedAt: new Date().toISOString(), baseBranch: "main" });
      turn(devPreviewBaseKey(id), settings.pmEnabled);
      return view(id);
    },
    removeProject: async (id) => {
      configs.delete(id);
      turn(devPreviewBaseKey(id), false);
      return view(id);
    },
    session: async (id) => sessionState(id),
    startSession: async (id) => {
      turn(devPreviewSessionKey(id), true);
      return sessionState(id);
    },
    stopSession: async (id) => {
      turn(devPreviewSessionKey(id), false);
      return sessionState(id);
    },
    base: async (id) => state(devPreviewBaseKey(id), id, null),
    setPm: async (id, enabled) => {
      const config = configs.get(id);
      if (config) configs.set(id, { ...config, pmEnabled: enabled });
      turn(devPreviewBaseKey(id), enabled && Boolean(config));
      return state(devPreviewBaseKey(id), id, null);
    },
    updateBase: async (id) => state(devPreviewBaseKey(id), id, null),
    log: async (key) => ({ key, lines: ["(the mock client runs no commands)"] }),
    stopAll: async () => {
      const stopped = running.size;
      running.clear();
      return { stopped, failed: [] };
    },
    servers: async () => ({
      remote: false,
      servers: sortDevPreviewServers(
        [...running].map((key) => {
          const sessionId = key.startsWith(SESSION) ? key.slice(SESSION.length) : null;
          const preview = sessionId
            ? sessionState(sessionId)
            : state(key, key.slice(BASE.length), null);
          return {
            state: preview,
            projectName: world.projectName?.(preview.projectId) ?? preview.projectId,
            sessionTitle: sessionId ? (world.sessionTitle?.(sessionId) ?? sessionId) : null,
          };
        }),
      ),
    }),
    stopServers: async (keys) => {
      for (const key of keys) {
        if (key.startsWith(BASE)) switchPmOff(key.slice(BASE.length));
        else turn(key, false);
      }
      return { stopped: [...keys], failed: [] };
    },
  };
}
