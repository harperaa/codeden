import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Go } from "./use-go";

/**
 * The green of a button that starts something: the design system's "done" status colour. The
 * label takes the theme's dark text colour on it in both themes (7:1 or more), since white on
 * that green falls short of AA.
 */
export const START_GREEN =
  "bg-status-done font-semibold text-foreground hover:bg-status-done/85 dark:text-background";

/**
 * Go: one press checks everything and, when it all holds, creates the project and starts its
 * setup. Green (`START_GREEN`).
 */
export function GoButton({
  busy,
  disabled,
  type = "button",
  onClick,
}: {
  busy: Go["busy"];
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled || busy !== null}
      aria-busy={busy !== null}
      data-testid="secure-foundation-go"
      className={cn("min-w-20", START_GREEN)}
    >
      {busy && <Loader2 className="animate-spin" />}
      {busy === "checking" ? "Checking…" : busy === "creating" ? "Creating…" : "Go"}
    </Button>
  );
}
