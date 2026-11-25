import {
  DEV_PREVIEW_LOG_LINES,
  DEV_PREVIEW_NO_PREPARE_HINT,
  DEV_PREVIEW_TAIL_LINES,
  type DevPreviewConfig,
  type DevPreviewStatus,
  expandDevPreviewCommand,
  previewUrlInLine,
  stripTerminalCodes,
} from "@codeden/contracts";
import { endedAsNotInstalled } from "./failure-hint";
import type { RunningRegistry } from "./leftovers";
import { type PreparedStore, snapshotFolder } from "./lockfile";
import { type PreviewExit, type PreviewProcess, previewEnv, type SpawnPreview } from "./process";

/** What a preview needs from outside; all of it is replaced in tests. */
export interface PreviewDeps {
  spawn: SpawnPreview;
  isListening: (port: number) => Promise<boolean>;
  now: () => number;
  registry: RunningRegistry;
  prepared: PreparedStore;
  /** How long a stopped process gets before it is forced to end. */
  stopGraceMs: number;
  /** How long the dev command may run without anything listening. */
  startTimeoutMs: number;
  /** How long the prepare command may run. */
  prepareTimeoutMs: number;
  /** May a preview link to this port? Not the app's own, whatever a command prints. */
  linkable: (port: number) => boolean;
}

export interface PreviewTarget {
  key: string;
  kind: "session" | "base";
  projectId: string;
  sessionId: string | null;
  /** The worktree the commands run in. */
  cwd: string;
}

const ACTIVE: ReadonlySet<DevPreviewStatus> = new Set(["preparing", "starting", "running"]);

function exitText(exit: PreviewExit): string {
  if (exit.error) return `couldn't be started: ${exit.error}`;
  if (exit.signal) return `was ended by ${exit.signal}`;
  return `exited with code ${exit.code ?? "unknown"}`;
}

/**
 * One preview: the prepare command when it is due, then the dev command, then waiting until
 * something listens. It restarts a dev command that exits by itself once, and never again
 * until a person starts it.
 */
export class Preview {
  status: DevPreviewStatus = "off";
  url: string | null = null;
  ports: number[] = [];
  message: string | null = null;
  startedAt: number | null = null;
  /** Starts waiting their turn for this preview; while there are any, it is kept. */
  claimed = 0;

  private readonly lines: string[] = [];
  private partial = "";
  private proc: PreviewProcess | null = null;
  private settings: DevPreviewConfig | null = null;
  /** Bumped by every start and stop; work begun under an older number steps aside. */
  private run = 0;
  private retried = false;
  private everRan = false;
  private spawnedAt = 0;
  private printed: { url: string; port: number } | null = null;
  private launching: Promise<void> = Promise.resolve();
  /** Processes that were asked to stop and haven't ended yet. */
  private readonly stopping = new Map<PreviewProcess, Promise<void>>();

  constructor(
    readonly target: PreviewTarget,
    private readonly deps: PreviewDeps,
  ) {}

  /** When the settings it was last started with were confirmed; null before any start. */
  get confirmedAt(): string | null {
    return this.settings?.confirmedAt ?? null;
  }

  get active(): boolean {
    return ACTIVE.has(this.status);
  }

  log(): string[] {
    return this.partial ? [...this.lines, this.partial] : [...this.lines];
  }

  tail(): string[] {
    return this.log().slice(-DEV_PREVIEW_TAIL_LINES);
  }

  /** Start with confirmed settings on ports the service allocated. */
  async start(settings: DevPreviewConfig, ports: number[]): Promise<void> {
    const run = ++this.run;
    this.settings = settings;
    this.ports = ports;
    this.lines.length = 0;
    this.partial = "";
    this.message = null;
    this.url = null;
    this.retried = false;
    this.everRan = false;
    this.startedAt = this.deps.now();
    // Set before the first await, so the ports and the slot count as taken at once.
    this.status = settings.prepareCommand ? "preparing" : "starting";
    await this.end();
    if (run !== this.run) return;
    // Not awaited: a prepare command can run for minutes, and the caller only starts it.
    this.launching = this.launch(run).catch((error) => {
      if (run !== this.run) return;
      this.status = "failed";
      this.message = `The preview couldn't be started: ${String(error)}`;
    });
  }

  /** Resolves when the start under way has spawned the dev command (or failed to). */
  settled(): Promise<void> {
    return this.launching;
  }

  /** Stop it. `status` and `message` say how it shows afterwards. */
  async stop(
    status: Extract<DevPreviewStatus, "off" | "stopped" | "failed"> = "off",
    message: string | null = null,
  ): Promise<void> {
    this.run++;
    this.status = status;
    this.message = message;
    this.url = null;
    if (status === "off") this.startedAt = null;
    await this.end();
  }

  /** Force its process to end now, without waiting (the app is exiting). */
  killNow(): void {
    this.run++;
    this.proc?.killNow();
    for (const proc of this.stopping.keys()) proc.killNow();
  }

  /** Look once: is something listening yet, or has it taken too long? */
  async poll(): Promise<void> {
    if (this.status === "preparing") {
      if (this.deps.now() - this.spawnedAt > this.deps.prepareTimeoutMs) {
        const minutes = Math.round(this.deps.prepareTimeoutMs / 60_000);
        await this.stop("failed", `The prepare command didn't finish in ${minutes} minutes.`);
      }
      return;
    }
    if (this.status !== "starting" || !this.proc || !this.settings) return;
    const run = this.run;
    const first = this.ports[0];
    const candidate =
      this.settings.urlFrom === "output"
        ? this.printed
        : first === undefined
          ? null
          : { url: `http://localhost:${first}`, port: first };
    if (candidate && (await this.deps.isListening(candidate.port))) {
      if (run !== this.run || this.status !== "starting") return;
      this.status = "running";
      this.url = candidate.url;
      this.everRan = true;
      return;
    }
    if (run !== this.run) return;
    if (this.deps.now() - this.spawnedAt > this.deps.startTimeoutMs) {
      const minutes = Math.round(this.deps.startTimeoutMs / 60_000);
      await this.stop(
        "failed",
        candidate
          ? `Nothing was listening on port ${candidate.port} after ${minutes} minutes.`
          : `The dev command printed no local URL in ${minutes} minutes.`,
      );
    }
  }

  private async end(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    // Kept until it is really gone: a process that takes its time to stop can still be
    // forced to end if the app quits meanwhile, and closing the app waits for it.
    const stopped = proc.stop(this.deps.stopGraceMs).finally(() => {
      this.stopping.delete(proc);
      this.deps.registry.remove(proc.pid);
    });
    this.stopping.set(proc, stopped);
    await stopped;
  }

  /** Resolves when every process this preview was asked to stop has ended. */
  async ended(): Promise<void> {
    await Promise.all([...this.stopping.values()].map((p) => p.catch(() => {})));
  }

  /** Processes of this preview are still on their way out. */
  get stopsPending(): boolean {
    return this.stopping.size > 0;
  }

  private env(): NodeJS.ProcessEnv {
    // Loopback as the host to bind, no browser window of the dev server's own, plain output.
    const extra: Record<string, string> = {
      HOST: "127.0.0.1",
      BROWSER: "none",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    };
    (this.settings?.portVars ?? []).forEach((name, i) => {
      const port = this.ports[i];
      if (port !== undefined) extra[name] = String(port);
    });
    return previewEnv(extra);
  }

  private spawn(command: string): PreviewProcess {
    const proc = this.deps.spawn({
      command: expandDevPreviewCommand(command, this.ports),
      cwd: this.target.cwd,
      env: this.env(),
      onOutput: (text) => this.output(text),
    });
    this.proc = proc;
    this.deps.registry.add(this.target.key, proc, this.target.cwd);
    return proc;
  }

  private async launch(run: number): Promise<void> {
    const settings = this.settings;
    if (!settings) return;
    const { cwd } = this.target;
    const prepare = settings.prepareCommand;
    if (prepare && this.deps.prepared.needs(cwd, prepare)) {
      this.status = "preparing";
      this.spawnedAt = this.deps.now();
      this.note(`$ ${prepare}`);
      // What the folder holds now: what is new when the command ends is what it installed.
      const before = snapshotFolder(cwd);
      const proc = this.spawn(prepare);
      const exit = await proc.exited;
      // What the prepare command left running in its group ends with it.
      proc.killNow();
      this.deps.registry.remove(proc.pid);
      if (run !== this.run) return;
      this.proc = null;
      if (exit.error || exit.code !== 0) {
        this.status = "failed";
        this.message = `The prepare command ${exitText(exit)}.`;
        return;
      }
      this.deps.prepared.record(cwd, prepare, before);
    }
    this.status = "starting";
    this.printed = null;
    this.spawnedAt = this.deps.now();
    this.note(`$ ${expandDevPreviewCommand(settings.command, this.ports)}`);
    const proc = this.spawn(settings.command);
    void proc.exited.then((exit) => this.exited(run, proc, exit));
  }

  /** The dev command ended by itself (a stop bumps `run` first, so it never gets here). */
  private exited(run: number, proc: PreviewProcess, exit: PreviewExit): void {
    this.deps.registry.remove(proc.pid);
    if (run !== this.run) return;
    this.proc = null;
    this.url = null;
    // What it started may still hold the ports.
    proc.killNow();
    if (!this.retried && !exit.error) {
      this.retried = true;
      this.message = `The dev command ${exitText(exit)} and was restarted once.`;
      this.launching = this.launch(run).catch((error) => {
        if (run !== this.run) return;
        this.status = "failed";
        this.message = `The dev command couldn't be restarted: ${String(error)}`;
      });
      return;
    }
    this.status = this.everRan ? "stopped" : "failed";
    this.message = this.everRan
      ? `The dev command ${exitText(exit)}.`
      : `The dev command ${exitText(exit)} before anything was listening.${this.prepareHint(exit)}`;
  }

  /**
   * What to add when the dev command never came up because its programs aren't there and the
   * project has no prepare command. With one set, nothing: it ran, so the cause is another.
   */
  private prepareHint(exit: PreviewExit): string {
    if (this.settings?.prepareCommand) return "";
    return endedAsNotInstalled(exit, this.log()) ? ` ${DEV_PREVIEW_NO_PREPARE_HINT}` : "";
  }

  private note(line: string): void {
    this.flush();
    this.push(line);
  }

  private flush(): void {
    if (!this.partial) return;
    this.push(this.partial);
    this.partial = "";
  }

  private push(line: string): void {
    this.lines.push(stripTerminalCodes(line).slice(0, 4000));
    if (this.lines.length > DEV_PREVIEW_LOG_LINES) {
      this.lines.splice(0, this.lines.length - DEV_PREVIEW_LOG_LINES);
    }
    if (this.status !== "starting" || this.printed || this.settings?.urlFrom !== "output") return;
    const printed = previewUrlInLine(line, this.settings.urlPattern);
    // A dev command can print any address. One on the app's own port is never the preview.
    if (printed && this.deps.linkable(printed.port)) this.printed = printed;
  }

  private output(text: string): void {
    const parts = (this.partial + text).split(/\r?\n|\r/);
    this.partial = (parts.pop() ?? "").slice(0, 4000);
    for (const part of parts) this.push(part);
  }
}
