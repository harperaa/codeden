import { MonitorPlay } from "lucide-react";
import { useState } from "react";
import { lazyComponent } from "@/components/common/lazy-component";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { plural } from "@/lib/format";
import { useSnapshot } from "@/lib/queries";
import { PageHeader } from "@/routes/page-header";
import { DevServersHint, DevServersHowTo } from "./how-to";
import { DevServerRow } from "./row";
import { devServerActive, useDevServers } from "./use-dev-servers";

/** The log viewer the strip opens, loaded when someone opens it. */
const LogDialog = lazyComponent(
  () => import("@/components/harden/dev-preview/log-dialog").then((m) => m.DevPreviewLogDialog),
  null,
);

/**
 * Dev Servers (`docs/dev-preview.md`): every dev preview of every project, the PM threads' and
 * the sessions', in one list, to watch them and to stop them and get their memory and ports
 * back. It only monitors and stops: a preview is switched on at the top of its own page, and
 * nothing here can start one or name a command.
 */
export function DevServersPage() {
  const { list, error, servers, failures, stop, stopAll, stopping } = useDevServers();
  const { data: snapshot } = useSnapshot();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [logKey, setLogKey] = useState<string | null>(null);

  // A row that left the list (stopped elsewhere) is no longer selected.
  const selected = servers.filter((s) => picked.has(s.state.key)).map((s) => s.state.key);
  const running = servers.filter(devServerActive).length;
  const busy = stop.isPending || stopAll.isPending;
  const pick = (key: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const allPicked = servers.length > 0 && selected.length === servers.length;
  const projects = (snapshot?.projects ?? []).filter((p) => !p.archivedAt);

  return (
    <>
      <PageHeader
        icon={<MonitorPlay />}
        title="Dev Servers"
        meta={list && servers.length > 0 ? `${running} running` : undefined}
        actions={
          servers.length > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={busy || selected.length === 0}
                onClick={() => stop.mutate(selected)}
                data-testid="dev-servers-stop-selected"
              >
                Stop selected{selected.length > 0 ? ` (${selected.length})` : ""}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={busy || running === 0}
                onClick={() => setConfirming(true)}
                data-testid="dev-servers-stop-all"
              >
                Stop all
              </Button>
            </>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div
          className="mx-auto w-full max-w-5xl space-y-3 px-4 py-5 sm:px-6"
          data-testid="dev-servers-page"
        >
          {!list ? (
            error ? (
              <p className="text-xs text-status-failed" role="alert">
                Couldn't load the dev servers: {error.message}
              </p>
            ) : (
              <Skeleton className="h-24 rounded-xl" />
            )
          ) : servers.length === 0 ? (
            <DevServersHowTo remote={list.remote} projects={projects} />
          ) : (
            <>
              <DevServersHint remote={list.remote} />
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <label className="flex items-center gap-4 border-b border-border/70 px-4 py-2 text-2xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={allPicked}
                    onChange={(event) =>
                      setPicked(
                        new Set(event.target.checked ? servers.map((s) => s.state.key) : []),
                      )
                    }
                    data-testid="dev-servers-select-all"
                  />
                  Select all ({servers.length})
                </label>
                <ul className="divide-y divide-border/70" data-testid="dev-servers-list">
                  {servers.map((server) => (
                    <DevServerRow
                      key={server.state.key}
                      server={server}
                      selected={picked.has(server.state.key)}
                      stopping={stopping(server.state.key)}
                      failure={failures[server.state.key]}
                      now={Date.now()}
                      onSelect={(on) => pick(server.state.key, on)}
                      onStop={() => stop.mutate([server.state.key])}
                      onLog={() => setLogKey(server.state.key)}
                    />
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent data-testid="dev-servers-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop {plural(running, "dev server")}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every running dev preview in every project ends, and its ports are free again. A
              session's preview is switched off. A PM thread's preview keeps its switch on and stays
              stopped until you press Restart on its page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => stopAll.mutate()}
              data-testid="dev-servers-confirm-stop"
            >
              Stop {plural(running, "dev server")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {logKey && <LogDialog previewKey={logKey} onClose={() => setLogKey(null)} />}
    </>
  );
}
