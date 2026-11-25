import type { DevPreviewServer } from "@codeden/contracts";
import { Link } from "@tanstack/react-router";
import { ScrollText, Square } from "lucide-react";
import { DevPreviewLink, DevPreviewStatusChip } from "@/components/harden/dev-preview/bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { devServerActive, devServerName, uptime } from "./use-dev-servers";

/**
 * One dev server: what it belongs to (a link to that page), how it is doing, its link, and
 * the two things this page does with it: open its log, and stop it. No row can start one.
 */
export function DevServerRow({
  server,
  selected,
  stopping,
  failure,
  now,
  onSelect,
  onStop,
  onLog,
}: {
  server: DevPreviewServer;
  selected: boolean;
  /** A stop of this row is under way. */
  stopping: boolean;
  /** Why the last stop of this row failed. */
  failure: string | undefined;
  now: number;
  onSelect: (on: boolean) => void;
  onStop: () => void;
  onLog: () => void;
}) {
  const { state } = server;
  const name = devServerName(server);
  const active = devServerActive(server);
  const owner = state.sessionId ? (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: state.sessionId }}
      className="truncate font-medium underline-offset-2 hover:underline"
      data-testid="dev-server-owner"
    >
      {server.sessionTitle}
    </Link>
  ) : (
    <Link
      to="/projects/$projectId/pm"
      params={{ projectId: state.projectId }}
      className="truncate font-medium underline-offset-2 hover:underline"
      data-testid="dev-server-owner"
    >
      PM thread
    </Link>
  );
  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-xs"
      data-testid="dev-server-row"
      data-key={state.key}
    >
      <input
        type="checkbox"
        className="size-3.5 shrink-0 accent-primary"
        aria-label={`Select ${name}`}
        checked={selected}
        onChange={(event) => onSelect(event.target.checked)}
      />
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-muted-foreground" data-testid="dev-server-project">
            {server.projectName}
          </span>
          <span className="text-muted-foreground/60">·</span>
          {owner}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs">
          <DevPreviewStatusChip state={state} />
          {active && state.startedAt && (
            <span className="text-muted-foreground tabular-nums" data-testid="dev-server-uptime">
              up {uptime(now - Date.parse(state.startedAt))}
            </span>
          )}
          {state.ports.length > 0 && (
            <span className="text-muted-foreground tabular-nums" data-testid="dev-server-ports">
              {state.ports.length === 1 ? "port" : "ports"} {state.ports.join(", ")}
            </span>
          )}
          {state.base && (
            <span className="font-mono text-muted-foreground" data-testid="dev-server-base">
              {state.base.branch}
              {state.base.commit ? ` @ ${state.base.commit.slice(0, 7)}` : ""}
            </span>
          )}
        </span>
        {(failure ?? state.message) && (
          <span
            className={cn(
              "text-2xs wrap-anywhere",
              failure || state.status === "failed" ? "text-status-failed" : "text-muted-foreground",
            )}
            role={failure ? "alert" : undefined}
            data-testid={failure ? "dev-server-stop-failed" : "dev-server-message"}
          >
            {failure ? `Not stopped: ${failure}` : state.message}
          </span>
        )}
      </div>
      <div className="min-w-0 text-2xs">
        {state.url && <DevPreviewLink url={state.url} remote={state.remote} />}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button size="xs" variant="ghost" onClick={onLog} aria-label={`Log of ${name}`}>
          <ScrollText />
          Log
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={stopping}
          onClick={onStop}
          aria-label={`${active ? "Stop" : "Switch off"} ${name}`}
          // One that already ended has no process left: switching it off takes it off the list.
          title={active ? undefined : "It isn't running. Switching it off takes it off this list."}
          data-testid="dev-server-stop"
        >
          <Square />
          {active ? "Stop" : "Switch off"}
        </Button>
      </div>
    </li>
  );
}
