import {
  DEV_SERVERS_STOP_MAX,
  type DevPreviewServer,
  type DevPreviewServerList,
  type DevPreviewServersStopped,
} from "@codeden/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { devPreviewKey, devServersKey } from "@/components/harden/dev-preview/use-dev-preview";
import { useClient } from "@/lib/api";
import { plural } from "@/lib/format";

/** What a row belongs to, as one name: "my-site · PM thread", "my-site · Checkout". */
export function devServerName(server: DevPreviewServer): string {
  return `${server.projectName} · ${server.sessionTitle ?? "PM thread"}`;
}

/** Coming up or running: it has a process. A stopped or failed one has none any more. */
export function devServerActive(server: DevPreviewServer): boolean {
  const { status } = server.state;
  return status === "preparing" || status === "starting" || status === "running";
}

/** "42s", "12m", "3h 4m". */
export function uptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** As often as a thread's strip asks, and no faster: quicker only while something comes up. */
function pollEvery(list: DevPreviewServerList | undefined): number {
  const comingUp = list?.servers.some(
    (s) => s.state.status === "preparing" || s.state.status === "starting",
  );
  return comingUp ? 1_500 : 5_000;
}

/**
 * The list of every project's dev previews. It is asked for again every few seconds, like a
 * strip's state, and at once after a strip or this page changed a preview (both invalidate the
 * shared `dev-preview` keys). `background`: the sidebar's count, which asks rarely.
 */
export function useDevServerList(opts: { background?: boolean } = {}) {
  const client = useClient();
  return useQuery({
    queryKey: devServersKey,
    queryFn: () => client.devPreview.servers(),
    refetchInterval: (query) => (opts.background ? 30_000 : pollEvery(query.state.data)),
    retry: false,
  });
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The page's list and its stops. A stop is the owning page's own switch-off, asked for per
 * preview, also for Stop all. Nothing here starts a preview.
 *
 * Stops may overlap: every key being stopped is kept until its own request answers, so a row
 * shows it for as long as it lasts and can't be asked twice.
 */
export function useDevServers() {
  const client = useClient();
  const queryClient = useQueryClient();
  const list = useDevServerList();
  const servers = list.data?.servers ?? [];
  /** Why a row's last stop failed, by its key. */
  const [failures, setFailures] = useState<Record<string, string>>({});
  /** The keys being stopped, across every request under way. */
  const pending = useRef(new Set<string>());
  const [, redraw] = useState(0);
  /** The bulk action under way, if one is. */
  const [bulk, setBulk] = useState<"selected" | "all" | null>(null);

  const nameOf = (key: string) => {
    const server = servers.find((s) => s.state.key === key);
    return server ? devServerName(server) : key;
  };
  const report = (answer: DevPreviewServersStopped, asked: string[] | null) => {
    setFailures((current) => {
      // What was asked again and went through is no longer failed.
      const kept = Object.entries(current).filter(
        ([key]) => asked !== null && !asked.includes(key),
      );
      return Object.fromEntries([...kept, ...answer.failed.map((f) => [f.key, f.message])]);
    });
    if (answer.failed.length > 0) {
      toast.error(`Couldn't stop ${plural(answer.failed.length, "dev server")}`, {
        description: answer.failed.map((f) => `${nameOf(f.key)}: ${f.message}`).join("\n"),
      });
    }
    if (answer.stopped.length > 0) {
      toast.success(`Stopped ${plural(answer.stopped.length, "dev server")}`);
    }
  };
  // The strips on the owning pages and this list hear of it at once.
  const refresh = () => void queryClient.invalidateQueries({ queryKey: devPreviewKey });

  /**
   * Switch these previews off. Keys already being stopped are left out, and a long list goes
   * in requests of at most what one may name, whose answers are put together. Resolves with
   * the keys that are off now.
   */
  const stop = async (keys: string[], as: "row" | "selected" = "row"): Promise<string[]> => {
    const asked = keys.filter((key) => !pending.current.has(key));
    if (asked.length === 0) return [];
    for (const key of asked) pending.current.add(key);
    redraw((n) => n + 1);
    if (as === "selected") setBulk("selected");
    const chunks: string[][] = [];
    for (let i = 0; i < asked.length; i += DEV_SERVERS_STOP_MAX) {
      chunks.push(asked.slice(i, i + DEV_SERVERS_STOP_MAX));
    }
    const answer: DevPreviewServersStopped = { stopped: [], failed: [] };
    const results = await Promise.allSettled(
      chunks.map((chunk) => client.devPreview.stopServers(chunk)),
    );
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        answer.stopped.push(...result.value.stopped);
        answer.failed.push(...result.value.failed);
        return;
      }
      // The request itself failed: none of its previews is known to be stopped.
      for (const key of chunks[i] ?? []) {
        answer.failed.push({ key, message: reason(result.reason) });
      }
    });
    for (const key of asked) pending.current.delete(key);
    if (as === "selected") setBulk(null);
    redraw((n) => n + 1);
    report(answer, asked);
    refresh();
    return answer.stopped;
  };

  /** Switch every listed preview off, and give up the starts that wait for their turn. */
  const stopAll = async (): Promise<void> => {
    setBulk("all");
    try {
      report(await client.devPreview.stopAllServers(), null);
    } catch (error) {
      toast.error("Dev servers not stopped", { description: reason(error) });
    } finally {
      setBulk(null);
      refresh();
    }
  };

  return {
    /** Undefined until the first answer. */
    list: list.data,
    error: list.error,
    servers,
    failures,
    stop,
    stopAll,
    bulk,
    /** A stop of this row is under way. */
    stopping: (key: string) => bulk === "all" || pending.current.has(key),
  };
}
