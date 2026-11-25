import type { DevPreviewConfig, DevPreviewProject } from "@codeden/contracts";
import type { ReactNode } from "react";
import { START_GREEN } from "@/components/harden/secure-foundation/go-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formChanged, type PreviewForm } from "./form";
import { useDevPreview } from "./use-dev-preview";

/**
 * What the form's button does, from what is stored and what the form holds:
 *
 * - `start`: nothing is stored and the PM thread's switch is on. Confirming stores the commands
 *   and starts the PM thread's preview.
 * - `save`: nothing is stored and the PM thread's switch is off. Confirming only stores them.
 * - `changes`: the form differs from what is stored.
 * - `again`: unchanged, but the project's base branch is no longer the one these settings were
 *   confirmed for. Confirming them again is how the PM thread's preview follows the new one.
 * - `stored`: unchanged. There is nothing to confirm; the stored commands can be started.
 *
 * All but `stored` open the confirmation dialog: no label here stores or runs anything itself.
 */
export type PreviewAction = "start" | "save" | "changes" | "again" | "stored";

export function previewAction(
  form: PreviewForm,
  view: Pick<DevPreviewProject, "config" | "baseBranch">,
): PreviewAction {
  const { config } = view;
  if (!config) return form.pmEnabled ? "start" : "save";
  if (formChanged(form, config)) return "changes";
  return config.baseBranch !== view.baseBranch ? "again" : "stored";
}

const LABEL: Record<Exclude<PreviewAction, "stored">, string> = {
  start: "Start preview…",
  save: "Save…",
  changes: "Save changes…",
  again: "Confirm again…",
};

/**
 * The row under the settings form: the one thing to do next, Remove, a line about the state
 * and when the stored settings were confirmed.
 * On another device there is nothing to do here.
 */
export function DevPreviewActions({
  projectId,
  view,
  form,
  problem,
  saving,
  removing,
  onAsk,
  onRemove,
}: {
  projectId: string;
  view: DevPreviewProject;
  form: PreviewForm;
  /** What is wrong with the form, after a press that couldn't ask. */
  problem: string | null;
  saving: boolean;
  removing: boolean;
  /** Open the confirmation dialog for what the form holds. */
  onAsk: () => void;
  onRemove: () => void;
}) {
  const { config, remote, baseBranch } = view;
  const action = previewAction(form, view);
  const removeButton = config && (
    <Button
      size="sm"
      variant="ghost"
      disabled={removing}
      onClick={onRemove}
      data-testid="dev-preview-remove"
    >
      Remove
    </Button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
      {remote ? (
        <p className="text-2xs text-muted-foreground" data-testid="dev-preview-remote">
          Set this up on the computer running the app.
        </p>
      ) : (
        <>
          {action !== "stored" && (
            <Button
              size="sm"
              onClick={onAsk}
              // With nothing stored, only a form nobody touched has nothing to confirm.
              disabled={saving || (!config && !formChanged(form, null))}
              className={cn(action === "start" && START_GREEN)}
              data-testid="dev-preview-save"
              data-action={action}
            >
              {LABEL[action]}
            </Button>
          )}
          {action === "stored" && config ? (
            <StoredPreview projectId={projectId} config={config}>
              {removeButton}
            </StoredPreview>
          ) : (
            removeButton
          )}
          {action === "again" && (
            <span
              className="min-w-0 flex-1 basis-48 text-2xs text-muted-foreground"
              data-testid="dev-preview-branch-changed"
            >
              The base branch is now {baseBranch ?? "not set"}; these settings were confirmed for{" "}
              {config?.baseBranch ?? "none"}. Confirm them again to follow it.
            </span>
          )}
        </>
      )}
      {problem && (
        <span className="text-2xs text-status-failed" role="alert">
          {problem}
        </span>
      )}
      <span
        className="ml-auto shrink-0 text-2xs text-muted-foreground"
        data-testid="dev-preview-confirmed"
      >
        {config
          ? `Confirmed ${new Date(config.confirmedAt).toLocaleString()}`
          : "Nothing runs until you confirm a command."}
      </span>
    </div>
  );
}

const RUNNING = {
  preparing: "is preparing",
  starting: "is starting",
  running: "is running",
} as const;

/**
 * Settings that are stored and unchanged: how the PM thread's preview is doing, and a button
 * that starts it when it isn't running. That button is the strip's Restart (`restart`), so it
 * asks nothing: the stored commands are the ones a person confirmed. Where it can't be started
 * from here, the reason is said instead.
 */
function StoredPreview({
  projectId,
  config,
  children,
}: {
  projectId: string;
  config: DevPreviewConfig;
  /** The row's other buttons, which stand between this one's button and its text. */
  children: ReactNode;
}) {
  const { state, restart } = useDevPreview({ projectId, sessionId: null });
  const note = (text: string, failed = false) => (
    <>
      {children}
      <span
        className={cn(
          "min-w-0 flex-1 basis-48 text-2xs",
          failed ? "text-status-failed" : "text-muted-foreground",
        )}
        data-testid="dev-preview-stored-note"
      >
        {text}
      </span>
    </>
  );
  if (!(state?.enabled ?? config.pmEnabled)) {
    return note(
      "The PM thread's preview is switched off. Switch it on at the top of the PM thread, or switch on “On the PM thread” here and save the change.",
    );
  }
  if (!state) return children;
  if (state.remote) return note("Previews are started on the computer running the app.");
  if (state.unavailable) return note(state.unavailable);
  if (state.status === "preparing" || state.status === "starting" || state.status === "running") {
    return note(`The PM thread's preview ${RUNNING[state.status]}.`);
  }
  return (
    <>
      <Button
        size="sm"
        className={START_GREEN}
        disabled={restart.isPending}
        onClick={() => restart.mutate()}
        data-testid="dev-preview-start"
      >
        {state.status === "off" ? "Start preview" : "Restart"}
      </Button>
      {note(
        state.message ??
          (state.status === "failed"
            ? "The PM thread's preview failed."
            : "The PM thread's preview isn't running."),
        state.status === "failed",
      )}
    </>
  );
}
