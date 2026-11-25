import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DevPreviewSettings, Project, type Session } from "@codeden/contracts";
import {
  type DevPreviewDeps,
  DevPreviewService,
} from "../../src/services/dev-preview/dev-preview-service";
import type { LeftoverOps } from "../../src/services/dev-preview/leftovers";
import type { PreviewExit, SpawnSpec } from "../../src/services/dev-preview/process";
import { DevPreviewStore } from "../../src/services/dev-preview/store";
import { notFound } from "../../src/services/errors";
import type { Exec } from "../../src/services/exec";
import { sampleSession } from "../helpers";

/** A process the scripted spawn "started": the test decides when and how it ends. */
export class FakeProcess {
  stopped = false;
  killed = false;
  readonly started = "Sat Nov  7 10:00:00 2026";
  ended = false;
  private end!: (exit: PreviewExit) => void;
  readonly exited = new Promise<PreviewExit>((resolve) => {
    this.end = resolve;
  });

  constructor(
    readonly pid: number,
    readonly spec: SpawnSpec,
  ) {}

  /** The command ends by itself. */
  exit(code: number): void {
    this.ended = true;
    this.end({ code, signal: null });
  }

  print(text: string): void {
    this.spec.onOutput(text);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.end({ code: null, signal: "SIGTERM" });
  }

  killNow(): void {
    this.killed = true;
  }
}

/** Settings as a person would confirm them; `pmEnabled` off unless a test is about it. */
export const SETTINGS: DevPreviewSettings = {
  command: "run-dev",
  prepareCommand: null,
  portVars: ["PORT"],
  urlFrom: "port",
  urlPattern: null,
  pmEnabled: false,
};

export function localProject(id: string, path: string, over: Partial<Project> = {}): Project {
  const now = "2026-11-07T10:00:00.000Z";
  return Project.parse({
    id,
    kind: "local",
    name: id,
    slug: id,
    path,
    isGitRepo: true,
    defaultBranch: "main",
    defaultProvider: null,
    defaultModel: null,
    defaultEffort: null,
    autonomy: null,
    visionPath: ".codeden/VISION.md",
    timezone: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...over,
  });
}

export interface PreviewEnv {
  service: DevPreviewService;
  store: DevPreviewStore;
  home: string;
  /** Every process started, in order. */
  procs: FakeProcess[];
  /** Ports something "listens" on. */
  listening: Set<number>;
  /** Ports that are taken by something else on the machine. */
  taken: Set<number>;
  projects: Map<string, Project>;
  sessions: Map<string, Session>;
  sandboxed: Set<string>;
  clock: { now: number };
  /** A project with a folder and an agent session with a worktree folder in it. */
  addProject(id: string, over?: Partial<Project>): Project;
  addSession(id: string, projectId: string, over?: Partial<Session>): Session;
  /** A second service over the same home, as after a restart. */
  restart(overrides?: Partial<DevPreviewDeps>): DevPreviewService;
  running(): FakeProcess[];
  close(): Promise<void>;
}

/** A system with no processes: nothing is ever left over, nothing is ever signalled. */
export const quietOps: LeftoverOps = {
  table: () => [],
  bootedAtMs: () => 0,
  kill: () => {
    throw new Error("no process should be signalled in this test");
  },
};

/**
 * The service over a temp home, with scripted processes, ports and clock. Nothing real is
 * started and no socket is opened.
 */
export function createPreviewEnv(
  opts: { exec?: Exec; overrides?: Partial<DevPreviewDeps> } = {},
): PreviewEnv {
  const home = mkdtempSync(join(tmpdir(), "dev-preview-"));
  const procs: FakeProcess[] = [];
  const listening = new Set<number>();
  const taken = new Set<number>();
  const projects = new Map<string, Project>();
  const sessions = new Map<string, Session>();
  const sandboxed = new Set<string>();
  const clock = { now: Date.parse("2026-11-07T10:00:00.000Z") };
  const store = new DevPreviewStore(home);
  let pid = 5000;
  const noGit: Exec = async () => {
    throw new Error("git isn't expected in this test");
  };
  const deps = (overrides: Partial<DevPreviewDeps> = {}): DevPreviewDeps => ({
    home,
    store: overrides.store ?? store,
    project: (id) => {
      const project = projects.get(id);
      if (!project) throw notFound("Project not found");
      return project;
    },
    session: (id) => sessions.get(id),
    sandboxed: (id) => sandboxed.has(id),
    exec: opts.exec ?? noGit,
    spawn: (spec) => {
      const proc = new FakeProcess(pid++, spec);
      procs.push(proc);
      return proc;
    },
    isListening: async (port) => listening.has(port),
    portIsFree: async (port) => !taken.has(port),
    leftoverOps: quietOps,
    now: () => clock.now,
    stopGraceMs: 0,
    startTimeoutMs: 60_000,
    baseCheckEveryMs: 90_000,
    ...opts.overrides,
    ...overrides,
  });
  const service = new DevPreviewService(deps());
  const extra: DevPreviewService[] = [];
  return {
    service,
    store,
    home,
    procs,
    listening,
    taken,
    projects,
    sessions,
    sandboxed,
    clock,
    addProject(id, over = {}) {
      const path = join(home, "projects", id);
      mkdirSync(path, { recursive: true });
      const project = localProject(id, path, over);
      projects.set(id, project);
      return project;
    },
    addSession(id, projectId, over = {}) {
      const worktreePath = join(home, "wt", projectId, id);
      mkdirSync(worktreePath, { recursive: true });
      const session: Session = {
        ...sampleSession,
        id,
        projectId,
        status: "idle",
        cwd: worktreePath,
        worktreePath,
        branch: `codeden/${id}`,
        baseBranch: "main",
        ...over,
      };
      sessions.set(id, session);
      return session;
    },
    restart(overrides = {}) {
      const next = new DevPreviewService(deps({ store: new DevPreviewStore(home), ...overrides }));
      extra.push(next);
      return next;
    },
    running: () => procs.filter((p) => !p.stopped && !p.ended),
    async close() {
      for (const s of [service, ...extra]) await s.stop();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
