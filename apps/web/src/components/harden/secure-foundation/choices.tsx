import type { SecureFoundationSecrets, SecureFoundationShell } from "@codeden/contracts";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The form's fixed choices and the two small pieces every field is made of. */

export const SECRETS: Array<[SecureFoundationSecrets, string, string]> = [
  [
    "doppler",
    "Doppler",
    "Secrets live in a Doppler project. Needs the Doppler CLI installed and signed in on this computer.",
  ],
  [
    "env_local",
    ".env.local",
    "Secrets are written to a file in the project folder that git ignores. Nothing else to set up.",
  ],
];

export const SHELLS: Array<[SecureFoundationShell, string, string]> = [
  ["all", "All modules", "Every content module the template has."],
  ["minimal", "Minimal", "Login homepage and a blank dashboard. Add modules later."],
  ["pick", "Pick", "Choose the content modules to install now."],
];

export function Choice({
  name,
  checked,
  onSelect,
  title,
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-2 rounded-lg border p-2.5 text-left transition-colors",
        checked ? "border-primary/50 bg-primary/[0.06]" : "border-border hover:bg-accent/40",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-0.5" />
      <span>
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-2xs leading-snug text-muted-foreground">{children}</span>
      </span>
    </label>
  );
}

export const Field = ({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) => (
  <div className="space-y-1.5">
    <Label htmlFor={htmlFor} className="text-xs">
      {label}
    </Label>
    {children}
  </div>
);
