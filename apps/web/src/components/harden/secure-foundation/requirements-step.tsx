import type { SecureFoundationRequirements } from "@codeden/contracts";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RequirementsList } from "./requirements-list";

export const REQUIREMENTS_INTRO =
  "Secure Foundation sets the project up for you. It needs a few tools on this computer and an account with each service; creating the account is all you need to do on their sites.";

/**
 * The requirements page inside the Secure Foundation dialog. It comes up by itself, in front of
 * the form, when the check found something every setup needs missing, and leaves by itself once
 * a check finds everything there; "Requirements" opens it at any time. It never holds anyone:
 * going on is always offered, because Go and the setup session make their own checks.
 */
export function RequirementsStep({
  result,
  checking,
  error,
  blocking,
  review,
  onCheck,
  onContinue,
  onCancel,
}: {
  result: SecureFoundationRequirements | undefined;
  checking: boolean;
  /** The check itself failed (another device, the server unreachable). */
  error: string | null;
  /** Something every setup needs is missing: checking again is the main action. */
  blocking: boolean;
  /** Opened by the person, not by a failed check. */
  review: boolean;
  onCheck: () => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4" data-testid="secure-foundation-requirements">
      <p className="text-xs text-muted-foreground">
        {review
          ? REQUIREMENTS_INTRO
          : `Something Secure Foundation needs isn't ready yet. Put it right here, so the setup doesn't have to stop for it. ${REQUIREMENTS_INTRO}`}
      </p>
      {error && !checking ? (
        <p className="rounded-lg border border-border p-2.5 text-xs" role="alert">
          The check couldn't run: {error} You can go on: Go makes its own checks.
        </p>
      ) : (
        <RequirementsList result={result} checking={checking} onCheck={onCheck} />
      )}
      <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-popover px-4 py-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={blocking ? "default" : "outline"}
          onClick={onCheck}
          disabled={checking}
          data-testid="requirements-check-again"
        >
          <RefreshCw className={cn(checking && "animate-spin")} /> Check again
        </Button>
        <Button
          type="button"
          variant={blocking ? "outline" : "default"}
          onClick={onContinue}
          data-testid="requirements-continue"
        >
          {review ? "Back to the form" : blocking ? "Continue anyway" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
