import { join } from "node:path";
import { type DevPreviewBase, devPreviewBaseKey, type Project } from "@codeden/contracts";
import { ServiceError } from "../errors";
import type { Exec } from "../exec";
import { removeBaseCheckout, syncBaseCheckout } from "./base-checkout";
import { previewBaseBranch } from "./eligibility";
import type { PreparedStore } from "./lockfile";
import type { Preview, PreviewTarget } from "./preview";
import type { DevPreviewStore } from "./store";

export interface BasePreviewsDeps {
  /** `<home>/dev-preview/base`: one checkout per project. */
  dir: string;
  store: DevPreviewStore;
  exec: Exec;
  project: (id: string) => Project | undefined;
  preview: (target: PreviewTarget) => Preview;
  existing: (key: string) => Preview | undefined;
  /** Make room, take ports and start (the service's own start path). */
  begin: (preview: Preview, opts: { byPerson: boolean; restart?: boolean }) => Promise<void>;
  prepared: PreparedStore;
  now: () => number;
  /** The least time between two looks at a project's base branch. */
  checkEveryMs: number;
  log?: (message: string) => void;
}

/**
 * The PM threads' previews: one per project with a confirmed dev command, unless a person
 * switched it off. Each runs from the app's own checkout of the project's base branch
 * (`base-checkout.ts`), which is fast-forwarded as the branch moves. The dev server's own hot
 * reload picks the new files up; the dev command is restarted only when the prepare command
 * had to run again, or after it stopped.
 */
export class BasePreviews {
  private readonly infos = new Map<string, DevPreviewBase>();
  private readonly checked = new Map<string, number>();
  /** Projects whose preview a person stopped with Stop all: only a person starts it again. */
  private readonly held = new Set<string>();
  /** Projects whose preview a person started since the app started. */
  private readonly clicked = new Set<string>();
  /** What to tell the person about the last look at the remote, per project. */
  private readonly notes = new Map<string, string>();
  /** Looks at the remote that failed in a row, per project: the next ones are spaced out. */
  private readonly failures = new Map<string, number>();
  private closed = false;
  private readonly busy = new Map<string, Promise<void>>();

  constructor(private readonly deps: BasePreviewsDeps) {}

  /** Where a project's base checkout lives. Never the project folder, never a session's. */
  path(project: Project): string {
    return join(
      this.deps.dir,
      `${project.slug}-${project.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}`,
    );
  }

  info(projectId: string): DevPreviewBase | null {
    return this.infos.get(projectId) ?? null;
  }

  /** Why the project can't have a base preview, or null. */
  unavailable(project: Project): string | null {
    if (project.archivedAt) return "The project is archived.";
    if (!project.isGitRepo) {
      return "The project folder isn't a git repository, so there is no base branch to preview.";
    }
    if (!previewBaseBranch(project)) return "The project has no base branch set.";
    return null;
  }

  /** A note about the last look at the base branch (the remote couldn't be reached). */
  note(projectId: string): string | null {
    return this.notes.get(projectId) ?? null;
  }

  /** The app is closing: no look at a branch starts or continues into a start. */
  close(): void {
    this.closed = true;
  }

  /** Every base preview stays stopped until a person starts it again. */
  holdAll(): void {
    for (const projectId of this.deps.store.projectIds()) this.held.add(projectId);
  }

  /** Look at every project whose turn it is (all of them with `all`). Doesn't wait. */
  checkDue(all: boolean): void {
    if (this.closed) return;
    for (const projectId of this.deps.store.projectIds()) {
      const project = this.deps.project(projectId);
      if (!project || project.archivedAt) {
        // An archived project keeps no dev preview: its settings and its checkout go.
        if (!this.busy.has(projectId)) void this.retire(projectId, project);
        continue;
      }
      if (!this.deps.store.config(projectId)?.pmEnabled) continue;
      const last = this.checked.get(projectId);
      // A remote that keeps failing is asked less often: 90 s, 3 min, 6 min, up to 24 min.
      const wait = this.deps.checkEveryMs * 2 ** Math.min(this.failures.get(projectId) ?? 0, 4);
      const due = last === undefined || this.deps.now() - last >= wait;
      if (!this.busy.has(projectId) && (all || due)) {
        void this.ensure(projectId, false).catch((error) => {
          this.deps.log?.(`[dev-preview] base preview of ${projectId}: ${String(error)}`);
        });
      }
    }
  }

  async idle(): Promise<void> {
    while (this.busy.size > 0)
      await Promise.all([...this.busy.values()].map((p) => p.catch(() => {})));
  }

  /**
   * Bring the project's base preview to where it should be: stopped when it is off, else its
   * checkout at the branch's tip and its dev command running. One at a time per project.
   * `byPerson`: a person asked (switched it on, pressed Update now), which also restarts a
   * preview that stopped or failed. The app by itself restarts one only when the branch moved.
   */
  ensure(projectId: string, byPerson: boolean): Promise<void> {
    this.checked.set(projectId, this.deps.now());
    const before = this.busy.get(projectId) ?? Promise.resolve();
    const run = before
      .catch(() => {})
      .then(() => this.sync(projectId, byPerson))
      .finally(() => {
        if (this.busy.get(projectId) === run) this.busy.delete(projectId);
      });
    this.busy.set(projectId, run);
    return run;
  }

  /**
   * The project's preview was removed: take its checkout away when git lets it go. Returns
   * why it was kept, when it was.
   */
  async forget(project: Project): Promise<string | null> {
    await this.busy.get(project.id)?.catch(() => {});
    await this.deps.existing(devPreviewBaseKey(project.id))?.stop("off");
    for (const map of [this.infos, this.checked, this.notes, this.failures]) map.delete(project.id);
    this.held.delete(project.id);
    this.clicked.delete(project.id);
    const path = this.path(project);
    const kept = await removeBaseCheckout(this.deps.exec, { repo: project.path, path });
    if (!kept) this.deps.prepared.forget(path);
    else this.deps.log?.(`[dev-preview] kept the base checkout of ${project.id}`);
    return kept;
  }

  private async retire(projectId: string, project: Project | undefined): Promise<void> {
    const run = (async () => {
      this.deps.store.remove(projectId);
      if (project) await this.forget(project);
      else await this.deps.existing(devPreviewBaseKey(projectId))?.stop("off");
    })().finally(() => {
      if (this.busy.get(projectId) === run) this.busy.delete(projectId);
    });
    this.busy.set(projectId, run);
    await run.catch((error) => this.deps.log?.(`[dev-preview] ${projectId}: ${String(error)}`));
  }

  private async sync(projectId: string, byPerson: boolean): Promise<void> {
    if (this.closed) return;
    const key = devPreviewBaseKey(projectId);
    const settings = this.deps.store.config(projectId);
    const project = this.deps.project(projectId);
    if (!settings?.pmEnabled || !project || project.archivedAt) {
      await this.deps.existing(key)?.stop("off");
      return;
    }
    if (byPerson) {
      this.held.delete(projectId);
      this.clicked.add(projectId);
    } else if (this.held.has(projectId)) return;
    const path = this.path(project);
    const preview = this.deps.preview({ key, kind: "base", projectId, sessionId: null, cwd: path });
    const branch = previewBaseBranch(project);
    const problem = this.unavailable(project);
    if (problem || !branch) {
      await preview.stop("stopped", problem);
      return;
    }
    if (settings.baseBranch !== branch) {
      // Others than the person at this computer can change a project's base branch (the
      // orchestrator, another device). They don't get to choose what a confirmed command runs.
      this.infos.set(projectId, {
        branch: settings.baseBranch ?? branch,
        commit: this.infos.get(projectId)?.commit ?? null,
        checkedAt: new Date(this.deps.now()).toISOString(),
        blocked: true,
      });
      await preview.stop(
        "stopped",
        `The project's base branch is now "${branch}"; this preview was confirmed for ${settings.baseBranch ? `"${settings.baseBranch}"` : "a project without one"}. Save the dev preview settings again to follow the new branch.`,
      );
      return;
    }
    if (project.factoryLimits.autoMerge && !this.clicked.has(projectId)) {
      // With automatic merges the base branch moves without anyone reading the change, so
      // this preview is started by a person, once each time the app starts.
      await preview.stop(
        "stopped",
        "Automatic merges are on for this project, so this preview waits for you to start it each time the app starts.",
      );
      return;
    }
    const was = this.infos.get(projectId);
    const result = await syncBaseCheckout(this.deps.exec, { repo: project.path, path, branch });
    // The app is closing, or the settings were changed or removed while git ran (that change
    // starts its own run).
    if (this.closed || this.deps.store.config(projectId) !== settings) return;
    // Stop all came in while git ran.
    if (!byPerson && this.held.has(projectId)) return;
    const unreachable = result.ok ? result.note : null;
    if (unreachable) this.notes.set(projectId, unreachable);
    else this.notes.delete(projectId);
    this.failures.set(projectId, unreachable ? (this.failures.get(projectId) ?? 0) + 1 : 0);
    this.infos.set(projectId, {
      branch,
      commit: result.ok ? result.commit.slice(0, 10) : (was?.commit ?? null),
      checkedAt: new Date(this.deps.now()).toISOString(),
      blocked: !result.ok,
    });
    if (!result.ok) {
      await preview.stop("stopped", result.message);
      return;
    }
    const prepare = settings.prepareCommand;
    if (preview.active && preview.confirmedAt === settings.confirmedAt) {
      // Running: the dev server reloads by itself. Only new dependencies need a restart.
      if (!(result.moved && prepare && this.deps.prepared.needs(path, prepare))) return;
    } else if (!byPerson && preview.status !== "off" && !result.moved && !was?.blocked) {
      // It stopped or failed and nothing changed since: no restart loop.
      return;
    }
    try {
      await this.deps.begin(preview, { byPerson, restart: true });
    } catch (error) {
      if (byPerson || !(error instanceof ServiceError)) throw error;
      await preview.stop("stopped", error.message);
    }
  }
}
