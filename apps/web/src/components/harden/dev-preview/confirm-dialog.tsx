import type { DevPreviewSettings } from "@codeden/contracts";
import type { ReactNode } from "react";
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

/**
 * The one question before a project's dev preview commands are stored: it shows the exact
 * commands, the port variables and what happens on the PM thread, and only "Save and allow"
 * calls `onConfirm`. The settings form and the switch at the top of a thread both ask it; there
 * is no other way to a stored command.
 */
export function DevPreviewConfirmDialog({
  asking,
  baseBranch,
  saving,
  onConfirm,
  onCancel,
  children,
}: {
  /** The settings to confirm; null keeps the dialog closed. */
  asking: DevPreviewSettings | null;
  /** The project's base branch, named when the PM thread's preview would follow it. */
  baseBranch: string | null;
  saving: boolean;
  onConfirm: (settings: DevPreviewSettings) => void;
  onCancel: () => void;
  /** More to say under the commands (where the values come from, a way to edit them). */
  children?: ReactNode;
}) {
  return (
    <AlertDialog open={asking !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent data-testid="dev-preview-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>Run these commands on this computer?</AlertDialogTitle>
          <AlertDialogDescription>
            The app runs them as you, in this project's worktrees, whenever a preview starts. They
            run the repository's own code (its dev script, and install scripts in the prepare step),
            including what an agent wrote in a session, with no approval step and with access to
            everything you can read. Previews that are running stop now: the PM thread's starts
            again with the new commands, a session's when you turn it on again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 text-xs">
          <Shown label="Dev command" command={asking?.command} />
          {asking?.prepareCommand && (
            <Shown label="Prepare command" command={asking.prepareCommand} />
          )}
          <p className="text-2xs text-muted-foreground">
            Ports go in {asking?.portVars.join(", ")}.{" "}
            {asking?.urlFrom === "output"
              ? "The link is the first local address the dev command prints."
              : "The link opens the first port."}{" "}
            {asking?.pmEnabled
              ? `A preview of the base branch${baseBranch ? ` (${baseBranch})` : ""} starts for the PM thread, and follows that branch only.`
              : "No preview starts for the PM thread."}
          </p>
          {children}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="dev-preview-confirm-run"
            disabled={saving}
            onClick={(event) => {
              event.preventDefault();
              if (asking) onConfirm(asking);
            }}
          >
            Save and allow
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Shown({ label, command }: { label: string; command: string | undefined }) {
  return (
    <div>
      <div className="mb-1 text-2xs text-muted-foreground">{label}</div>
      <pre className="overflow-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap wrap-anywhere">
        {command}
      </pre>
    </div>
  );
}
