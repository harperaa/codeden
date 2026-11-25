import { Link } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { RequirementsList } from "@/components/harden/secure-foundation/requirements-list";
import { REQUIREMENTS_INTRO } from "@/components/harden/secure-foundation/requirements-step";
import { useSecureFoundationRequirements } from "@/components/harden/secure-foundation/use-secure-foundation";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Secure Foundation Setup", opened from Settings: everything Secure Foundation needs, each
 * row with its state, also when all of it is there. The same list the Secure Foundation dialog
 * shows when something is missing.
 */
export function SecureFoundationSetupPage() {
  const requirements = useSecureFoundationRequirements(true);
  const check = () => void requirements.refetch();
  return (
    <div className="relative flex min-h-dvh flex-col items-center overflow-y-auto bg-background px-6 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(50%_100%_at_50%_0%,var(--glow),transparent)]"
      />
      <div className="relative w-full max-w-2xl" data-testid="secure-foundation-setup-page">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-4 size-12" />
          <h1 className="text-2xl font-semibold tracking-tight">Secure Foundation Setup</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">{REQUIREMENTS_INTRO}</p>
        </div>
        {requirements.error && !requirements.isFetching ? (
          <p className="rounded-xl border border-border bg-card p-4 text-[13px]" role="alert">
            The check couldn't run: {requirements.error.message}
          </p>
        ) : (
          <RequirementsList
            result={requirements.data}
            checking={requirements.isFetching}
            onCheck={check}
          />
        )}
        <div className="mt-6 flex items-center justify-between">
          <Button asChild variant="ghost">
            <Link to="/settings/$section" params={{ section: "general" }}>
              <ArrowLeft /> Back to Settings
            </Link>
          </Button>
          <Button variant="outline" onClick={check} disabled={requirements.isFetching}>
            <RefreshCw className={cn(requirements.isFetching && "animate-spin")} /> Check again
          </Button>
        </div>
      </div>
    </div>
  );
}
