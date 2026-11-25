import {
  type DevPreviewState,
  type DevPreviewStatus,
  HARDEN_DEV_PREVIEW_PORT_ERROR,
  type Session,
} from "@codeden/contracts";
import { ExternalLink, RefreshCw, ScrollText } from "lucide-react";
import { useState } from "react";
import { lazyComponent } from "@/components/common/lazy-component";
import { StatusDot } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Tone } from "@/lib/format";
import { platform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { devPreviewSettingsHref as settingsHref, useDevPreviewSetup } from "./setup";
import { type PreviewTarget, useDevPreview } from "./use-dev-preview";

/** The log viewer loads when someone opens it. */
const LogDialog = lazyComponent(
  () => import("./log-dialog").then((m) => m.DevPreviewLogDialog),
  null,
);

const LABEL: Record<DevPreviewStatus, string> = {
  off: "Off",
  preparing: "Preparing",
  starting: "Starting",
  running: "Running",
  stopped: "Stopped",
  failed: "Failed",
};
const TONE: Record<DevPreviewStatus, Tone> = {
  off: "idle",
  preparing: "running",
  starting: "running",
  running: "done",
  stopped: "idle",
  failed: "failed",
};

const REMOTE = "Previews are started on the computer running the app.";

/**
 * The strip under a thread's header: a session's own dev preview, or on the PM thread the
 * preview of the project's base branch. It is there for every project, set up or not, and
 * always off until a person switches it on; in a project with nothing stored yet the switch
 * asks first (`setup.tsx`). Nothing shows for a thread without a project.
 */
export function DevPreviewBar({ session }: { session: Session }) {
  if (!session.projectId) return null;
  if (session.role === "orchestrator") return null;
  return (
    <DevPreviewStrip
      projectId={session.projectId}
      sessionId={session.role === "agent" ? session.id : null}
    />
  );
}

/** The same strip for a PM thread that hasn't started yet. */
export function DevPreviewPmBar({ projectId }: { projectId: string | null }) {
  return projectId ? <DevPreviewStrip projectId={projectId} sessionId={null} /> : null;
}

function DevPreviewStrip(target: PreviewTarget) {
  const { state, turn, restart } = useDevPreview(target);
  const [logOpen, setLogOpen] = useState(false);
  const setup = useDevPreviewSetup(target, state);
  if (!state) return null;
  const base = target.sessionId === null;
  // This repository's own dev command says so when a port variable is missing: the fix is in
  // the settings, which offer the right ones.
  const portsMissing =
    state.status === "failed" &&
    !state.remote &&
    state.logTail.some((line) => line.startsWith(HARDEN_DEV_PREVIEW_PORT_ERROR));
  const busy = turn.isPending || restart.isPending;
  const blocked = state.enabled ? null : (state.unavailable ?? (state.remote ? REMOTE : null));
  const ended = state.status === "stopped" || state.status === "failed";
  return (
    <div className="shrink-0 border-b border-border/70" data-testid="dev-preview-bar">
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1 text-2xs">
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Focusable while disabled, so the reason is reachable by keyboard too. */}
            <span className="inline-flex items-center gap-2" tabIndex={blocked ? 0 : undefined}>
              <Switch
                size="sm"
                aria-label={base ? "Dev preview of the base branch" : "Dev preview"}
                data-testid="dev-preview-switch"
                checked={state.enabled}
                disabled={busy || blocked !== null || setup.loading}
                // Nothing stored for the project yet: ask first, or lead to the settings.
                onCheckedChange={(on) =>
                  on && !state.configured ? setup.begin() : turn.mutate(on)
                }
              />
              <span className="font-medium text-foreground/80">Dev preview</span>
            </span>
          </TooltipTrigger>
          {blocked && (
            <TooltipContent className="max-w-72 text-left leading-snug">{blocked}</TooltipContent>
          )}
        </Tooltip>
        {(state.enabled || ended) && <StatusChip state={state} />}
        {state.url && <PreviewLink url={state.url} remote={state.remote} />}
        {state.message && (
          <span
            className={cn(
              "min-w-0 truncate",
              state.status === "failed" ? "text-status-failed" : "text-muted-foreground",
            )}
            title={state.message}
            data-testid="dev-preview-message"
          >
            {state.message}
          </span>
        )}
        {portsMissing && (
          <a
            href={settingsHref(target.projectId)}
            className="shrink-0 underline underline-offset-2 hover:text-foreground"
            data-testid="dev-preview-fix-ports"
          >
            Check the port variables in the settings
          </a>
        )}
        {setup.needsCommand && (
          <>
            <span className="text-muted-foreground" data-testid="dev-preview-needs-command">
              Needs a dev command first.
            </span>
            <a
              href={settingsHref(target.projectId)}
              className="shrink-0 underline underline-offset-2 hover:text-foreground"
              data-testid="dev-preview-hint"
            >
              Set up a dev preview
            </a>
          </>
        )}
        {blocked && !state.message && (
          <span
            className="min-w-0 truncate text-muted-foreground"
            data-testid="dev-preview-blocked"
          >
            {blocked}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {state.base && state.enabled && (
            <span className="mr-1 text-muted-foreground" data-testid="dev-preview-base">
              {state.base.branch}
              {state.base.commit ? ` @ ${state.base.commit.slice(0, 7)}` : ""}
            </span>
          )}
          {state.enabled && (base || ended) && (
            <Button
              size="xs"
              variant="ghost"
              disabled={busy || state.remote}
              title={state.remote ? REMOTE : undefined}
              onClick={() => restart.mutate()}
              data-testid="dev-preview-restart"
            >
              <RefreshCw />
              {base && !ended ? "Update now" : "Restart"}
            </Button>
          )}
          {state.status !== "off" && (
            <Button size="xs" variant="ghost" onClick={() => setLogOpen(true)}>
              <ScrollText />
              Log
            </Button>
          )}
        </span>
      </div>
      {ended && state.logTail.length > 0 && (
        <pre
          data-testid="dev-preview-tail"
          className="mx-4 mb-2 max-h-28 overflow-auto rounded-md bg-muted/50 px-3 py-2 font-mono text-[11px] leading-[1.5] whitespace-pre-wrap wrap-anywhere text-muted-foreground scroll-thin"
        >
          {state.logTail.join("\n")}
        </pre>
      )}
      {logOpen && <LogDialog previewKey={state.key} onClose={() => setLogOpen(false)} />}
      {setup.dialog}
    </div>
  );
}

function StatusChip({ state }: { state: DevPreviewState }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-muted-foreground"
      data-testid="dev-preview-status"
      data-status={state.status}
    >
      <StatusDot tone={TONE[state.status]} />
      {LABEL[state.status]}
    </span>
  );
}

/** The link, once something answers on it. On another device it is shown but can't be opened. */
function PreviewLink({ url, remote }: { url: string; remote: boolean }) {
  const text = url.replace(/\/$/, "");
  if (remote) {
    return (
      <span
        className="font-mono text-muted-foreground"
        title="Open it on the computer running the app"
        data-testid="dev-preview-url"
      >
        {text}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      data-testid="dev-preview-url"
      className="inline-flex items-center gap-1 font-mono text-foreground underline-offset-2 hover:underline"
      onClick={(event) => {
        event.preventDefault();
        platform.openExternal(url);
      }}
    >
      {text}
      <ExternalLink className="size-3" />
    </a>
  );
}
