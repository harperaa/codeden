import {
  DEV_PREVIEW_RESERVED_PORTS,
  devPreviewPortCount,
  HARDEN_DEFAULT_PORT,
  type Session,
} from "@codeden/contracts";
import { conflict } from "../errors";
import type { PortAllocator } from "./ports";
import type { Preview } from "./preview";
import { makeRoom } from "./room";
import type { DevPreviewStore } from "./store";

export interface StarterDeps {
  store: DevPreviewStore;
  allocator: PortAllocator;
  previews: () => Preview[];
  session: (id: string) => Session | undefined;
  /** The port the app itself listens on, once known. */
  serverPort: () => number | null;
}

export const notConfigured = () =>
  conflict(
    "This project has no dev preview yet. Set its dev command in the project's settings first.",
    "not_configured",
  );

/**
 * The one place a preview is started from. Starts run one at a time, so two can't take the
 * same slot or the same port.
 *
 * What is started is always what the store holds at the moment of starting. The settings are
 * read here, never passed in, and read again after the waits (making room, finding ports):
 * a start that was under way while a person changed or removed the commands runs the new
 * ones or nothing, never the old.
 */
export class PreviewStarter {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  /** Bumped by `cancelPending`: a start asked for before the bump doesn't spawn after it. */
  private epoch = 0;

  constructor(private readonly deps: StarterDeps) {}

  /** Ports no preview may be given or link to: upstream's, this install's, the app's own. */
  reserved(): Set<number> {
    const ports = new Set<number>([...DEV_PREVIEW_RESERVED_PORTS, HARDEN_DEFAULT_PORT]);
    const own = this.deps.serverPort();
    if (own) ports.add(own);
    return ports;
  }

  /** Starts that are waiting their turn, or for ports, end without starting anything. */
  cancelPending(): void {
    this.epoch++;
  }

  /** No start after this; resolves when the one under way is done. */
  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
  }

  /**
   * Make room, take ports and start. A person's start may stop the oldest idle preview to
   * make room; one the app starts by itself never stops anyone's. With `restart` a preview
   * that already runs is started again; without it, it is left as it is.
   */
  begin(preview: Preview, opts: { byPerson: boolean; restart?: boolean }): Promise<void> {
    preview.claimed++;
    const epoch = this.epoch;
    const run = this.queue
      .then(() => this.start(preview, opts, epoch))
      .finally(() => {
        preview.claimed--;
      });
    this.queue = run.catch(() => {});
    return run;
  }

  private async start(
    preview: Preview,
    opts: { byPerson: boolean; restart?: boolean },
    epoch: number,
  ): Promise<void> {
    const { store } = this.deps;
    const stopped = () => conflict("The previews were stopped.", "stopped");
    const projectId = preview.target.projectId;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.closed) throw conflict("The app is closing.", "closing");
      if (epoch !== this.epoch) throw stopped();
      const settings = store.config(projectId);
      if (!settings) throw notConfigured();
      if (preview.active && !opts.restart) return;
      await makeRoom({
        previews: this.deps.previews(),
        preview,
        limits: store.limits(),
        evict: opts.byPerson,
        session: this.deps.session,
      });
      const limits = store.limits();
      const taken = this.reserved();
      for (const other of this.deps.previews()) {
        if (other !== preview && other.active) for (const port of other.ports) taken.add(port);
      }
      const ports = await this.deps.allocator.next(
        devPreviewPortCount(settings),
        { from: limits.portFrom, to: limits.portTo },
        taken,
      );
      if (!ports) {
        throw conflict(
          `No free port between ${limits.portFrom} and ${limits.portTo}. Stop a preview, or widen the range in Settings.`,
          "no_ports",
        );
      }
      // The waits above let other requests in. Start only if the settings are still these;
      // `Preview.start` takes them and marks itself active before it waits for anything.
      if (epoch !== this.epoch) throw stopped();
      if (this.closed || store.config(projectId) !== settings) continue;
      await preview.start(settings, ports);
      return;
    }
    throw conflict("The dev preview's settings keep changing. Try again.", "settings_changed");
  }
}
