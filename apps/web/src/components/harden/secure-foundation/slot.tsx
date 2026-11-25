import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { SECURE_FOUNDATION_SUBTITLE, SECURE_FOUNDATION_TITLE } from "./copy";
import { SecureFoundationDialog } from "./dialog";
import { useSecureFoundationOptions } from "./use-secure-foundation";

/**
 * The third choice of the add-project dialog: a new project made from the fork's template.
 * Renders nothing in a build without a template. All of the option lives in this folder; the
 * dialog it sits in only renders this slot.
 */
export function SecureFoundationSlot() {
  const { data: options } = useSecureFoundationOptions();
  const [open, setOpen] = useState(false);
  if (!options?.enabled) return null;
  const ready = options.providers.length > 0;
  return (
    <>
      <button
        type="button"
        data-testid="secure-foundation-option"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent/40"
      >
        <ShieldCheck className="mb-2 size-4 text-muted-foreground" />
        <div className="text-[13px] font-medium">{SECURE_FOUNDATION_TITLE}</div>
        <div className="mt-0.5 text-2xs leading-snug text-muted-foreground">
          {SECURE_FOUNDATION_SUBTITLE}
        </div>
        {!ready && (
          <div className="mt-1 text-2xs leading-snug text-amber-600 dark:text-amber-400">
            Needs a signed-in agent provider to run the install. Sign one in under Settings ›
            Providers, then come back.
          </div>
        )}
      </button>
      {open && <SecureFoundationDialog options={options} onClose={() => setOpen(false)} />}
    </>
  );
}
