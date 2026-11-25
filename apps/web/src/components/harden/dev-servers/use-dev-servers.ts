import type {
  DevPreviewServer,
  DevPreviewServerList,
  DevPreviewStopFailure,
} from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { devPreviewKey, devServersKey } from "@/components/harden/dev-preview/use-dev-preview";
import { useClient } from "@/lib/api";
import { plural } from "@/lib/format";

/** What a row belongs to, as one name: "my-site · PM thread", "my-site · Checkout". */
export function devServerName(server: DevPreviewServer): string {
  return `${server.projectName} · ${server.sessionTitle ?? "PM thread"}`;
}

/** Coming up or running: what a stop ends. A stopped or failed one has no process any more. */
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

/**
 * The page's list and its stops. A stop is the owning page's own switch-off, asked for per
 * preview; Stop all is the one Settings › Dev previews has. Nothing here starts a preview.
 */
export function useDevServers() {
  const client = useClient();
  const queryClient = useQueryClient();
  const list = useDevServerList();
  const servers = list.data?.servers ?? [];
  /** Why a row's last stop failed, by its key. */
  const [failures, setFailures] = useState<Record<string, string>>({});

  const nameOf = (key: string) => {
    const server = servers.find((s) => s.state.key === key);
    return server ? devServerName(server) : key;
  };
  const report = (stopped: number, failed: DevPreviewStopFailure[], asked: string[] | null) => {
    setFailures((current) => {
      // What was asked again and went through is no longer failed.
      const kept = Object.entries(current).filter(
        ([key]) => asked !== null && !asked.includes(key),
      );
      return Object.fromEntries([...kept, ...failed.map((f) => [f.key, f.message])]);
    });
    if (failed.length > 0) {
      toast.error(`Couldn't stop ${plural(failed.length, "dev server")}`, {
        description: failed.map((f) => `${nameOf(f.key)}: ${f.message}`).join("\n"),
      });
    }
    if (stopped > 0) toast.success(`Stopped ${plural(stopped, "dev server")}`);
  };
  // The strips on the owning pages and this list hear of it at once.
  const refresh = () => void queryClient.invalidateQueries({ queryKey: devPreviewKey });

  const stop = useMutation({
    mutationFn: (keys: string[]) => client.devPreview.stopServers(keys),
    onSuccess: (answer, keys) => report(answer.stopped.length, answer.failed, keys),
    onError: (e) => toast.error("Dev servers not stopped", { description: e.message }),
    onSettled: refresh,
  });
  const stopAll = useMutation({
    mutationFn: () => client.devPreview.stopAll(),
    onSuccess: (answer) => report(answer.stopped, answer.failed, null),
    onError: (e) => toast.error("Dev servers not stopped", { description: e.message }),
    onSettled: refresh,
  });

  return {
    /** Undefined until the first answer. */
    list: list.data,
    error: list.error,
    servers,
    failures,
    stop,
    stopAll,
    /** A stop of this row is under way. */
    stopping: (key: string) =>
      stopAll.isPending || (stop.isPending && (stop.variables ?? []).includes(key)),
  };
}
