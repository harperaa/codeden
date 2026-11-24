import type { SecureFoundationNeededFor } from "@codeden/contracts";
import { Info, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { StateIcon } from "@/components/setup/checklist";
import { Button } from "@/components/ui/button";
import { platform } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** One row of the requirements lists, in the format of the first-run checklist's rows. */

export type RowState = "checking" | "ok" | "warning" | "missing" | "info";

const ONLY_FOR: Record<SecureFoundationNeededFor, string | null> = {
  always: null,
  doppler: "only with secrets in Doppler",
  deploy: "only for the Deploy option",
  later: "for after the install",
};

function RowIcon({ state }: { state: RowState }) {
  if (state !== "info") return <StateIcon state={state} />;
  // Not a pass and not a fail: nothing the setup depends on.
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Info className="size-3.5" />
    </span>
  );
}

export function Row({
  id,
  state,
  label,
  neededFor,
  message,
  actions,
  children,
}: {
  id: string;
  state: RowState;
  label: string;
  neededFor: SecureFoundationNeededFor;
  message: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const failed = state === "missing";
  return (
    <div className="px-4 py-3" data-requirement={id} data-state={state}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:flex-nowrap">
        <RowIcon state={state} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13.5px] font-medium">
            {label}
            {ONLY_FOR[neededFor] ? (
              <span className="text-3xs font-normal text-muted-foreground">
                {ONLY_FOR[neededFor]}
              </span>
            ) : null}
          </div>
          <div
            className={cn(
              "text-2xs break-words",
              failed ? "text-status-failed/90" : "text-muted-foreground",
            )}
          >
            {state === "checking" ? "Checking…" : message}
          </div>
        </div>
        {actions && state !== "checking" && (
          <div className="flex min-w-0 basis-full flex-wrap items-center gap-1.5 pl-9 sm:basis-auto sm:pl-0">
            {actions}
          </div>
        )}
      </div>
      {state !== "checking" && children ? <div className="pl-9">{children}</div> : null}
    </div>
  );
}

/** Open a service's or a tool's own page in the person's browser. */
export const openPage = (url: string) => platform.openExternal(url);

export function Retry({ onCheck }: { onCheck: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onCheck}>
      <RefreshCw /> Retry
    </Button>
  );
}
