import {
  SecureFoundationEmail,
  SecureFoundationName,
  type SecureFoundationOptions,
  type SecureFoundationTemplate,
} from "@codeden/contracts";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormAnswers } from "./answers";
import { Choice, Field, SECRETS, SHELLS } from "./choices";
import { consentSummary, projectPath } from "./consent";
import { GoButton } from "./go-button";
import type { Go } from "./use-go";

export type { FormAnswers } from "./answers";

/**
 * The one form: everything the install would otherwise ask, with what pressing Go will do said
 * right above the buttons. Go is there as soon as the required answers are valid; Verify
 * Settings shows every check without starting anything.
 */
export function FormStep({
  options,
  template,
  templateError,
  onRetryTemplate,
  answers,
  onChange,
  busy,
  onGo,
  onVerify,
  onCancel,
}: {
  options: SecureFoundationOptions;
  template: SecureFoundationTemplate | undefined;
  templateError: string | null;
  onRetryTemplate: () => void;
  answers: FormAnswers;
  onChange: Dispatch<SetStateAction<FormAnswers>>;
  busy: Go["busy"];
  onGo: () => void;
  /** Open the verification view (also the consent lines' "Details"). */
  onVerify: () => void;
  onCancel: () => void;
}) {
  // On the answers as they are then: a suggestion that arrives while typing isn't lost.
  const set = (patch: Partial<FormAnswers>) => onChange((a) => ({ ...a, ...patch }));
  const name = SecureFoundationName.safeParse(answers.name);
  const email = SecureFoundationEmail.safeParse(answers.adminEmail);
  const path = name.success ? projectPath({ ...options, name: name.data }) : "";
  const ready = name.success && email.success && Boolean(answers.provider) && Boolean(template);
  const provider = options.providers.find((p) => p.id === answers.provider);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) onGo();
      }}
    >
      {/* While Go checks or creates, the answers it is working on can't be edited. */}
      <fieldset disabled={busy !== null} className="min-w-0 space-y-4 disabled:opacity-70">
        <Field label="Project name" htmlFor="sf-name">
          <Input
            id="sf-name"
            value={answers.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="My Site"
            maxLength={60}
            autoFocus
          />
          <p className="text-2xs text-muted-foreground" data-testid="secure-foundation-path">
            {answers.name && !name.success
              ? "Use letters, digits, spaces, dots, dashes and underscores, starting with a letter or digit."
              : path
                ? `Also the site's name. Created in ${path}`
                : "Also the site's name and, in lower case with dashes, the folder's."}
          </p>
        </Field>
        <Field label="Admin email" htmlFor="sf-email">
          <Input
            id="sf-email"
            type="email"
            value={answers.adminEmail}
            onChange={(e) => set({ adminEmail: e.target.value, emailTouched: true })}
            placeholder="you@your-domain.com"
            autoComplete="off"
          />
          <p className="text-2xs text-muted-foreground">
            {answers.adminEmail && !email.success
              ? "Enter a real email address: the install refuses placeholders."
              : "Who signs in as the site's admin. Suggested from git on this computer when it has one; it goes to the install and nowhere else."}
          </p>
        </Field>
        <Field label="Secrets">
          <div className="grid gap-2 sm:grid-cols-2">
            {SECRETS.map(([id, title, text]) => (
              <Choice
                key={id}
                name="sf-secrets"
                title={title}
                checked={answers.secrets === id}
                onSelect={() => set({ secrets: id })}
              >
                {text}
              </Choice>
            ))}
          </div>
        </Field>
        <Field label="App shell">
          <div className="grid gap-2 sm:grid-cols-3">
            {SHELLS.map(([id, title, text]) => (
              <Choice
                key={id}
                name="sf-shell"
                title={title}
                checked={answers.shell === id}
                onSelect={() => set({ shell: id })}
              >
                {text}
              </Choice>
            ))}
          </div>
          {answers.shell === "pick" && (
            <div className="space-y-1 pt-1">
              {(template?.modules ?? []).map((m) => (
                <label key={m.name} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={answers.modules.includes(m.name)}
                    onChange={(e) =>
                      set({
                        modules: e.target.checked
                          ? [...answers.modules, m.name]
                          : answers.modules.filter((n) => n !== m.name),
                      })
                    }
                  />
                  <span>
                    <span className="font-medium">{m.title}</span>{" "}
                    <span className="text-muted-foreground">{m.description}</span>
                  </span>
                </label>
              ))}
              {template && template.modules.length === 0 && (
                <p className="text-2xs text-muted-foreground">
                  This template has no content modules.
                </p>
              )}
            </div>
          )}
        </Field>
        <details className="rounded-lg border border-border p-2.5" data-testid="sf-advanced">
          <summary className="cursor-pointer text-xs font-medium">
            Advanced{" "}
            <span className="font-normal text-muted-foreground">
              Deploy {answers.deploy ? "on" : "off"} · runs on{" "}
              {provider?.displayName ?? "no signed-in provider"}
            </span>
          </summary>
          <div className="space-y-4 pt-3">
            <Field label="Deploy">
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={answers.deploy}
                  onChange={(e) => set({ deploy: e.target.checked })}
                />
                <span>
                  <span className="block text-[13px] font-medium">
                    Create a GitHub repository and deploy to Vercel
                  </span>
                  <span className="block text-2xs leading-snug text-muted-foreground">
                    A private repository and a Vercel project, with the site published on a public
                    vercel.app address running on the development Clerk and Convex. Needs the GitHub
                    command-line tool and a Vercel account; the repository's owner and name and the
                    Vercel scope are shown for you to check before anything is created. Off: the
                    project stays on this computer.
                  </span>
                </span>
              </label>
            </Field>
            <Field label="Runs on" htmlFor="sf-provider">
              {options.providers.length > 1 ? (
                <select
                  id="sf-provider"
                  value={answers.provider}
                  onChange={(e) => set({ provider: e.target.value })}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[13px]"
                >
                  {options.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-[13px]">{provider?.displayName ?? "No signed-in provider"}</p>
              )}
              <p className="text-2xs text-muted-foreground">
                {!provider
                  ? "Sign an agent provider in under Settings › Providers first."
                  : provider.runsCommandFiles
                    ? "The setup session runs the template's /install command."
                    : "This provider doesn't run command files: the setup session reads the template's install instructions and follows them."}
              </p>
            </Field>
          </div>
        </details>
      </fieldset>
      {templateError ? (
        <p className="text-xs text-destructive" role="alert">
          The template couldn't be reached: {templateError}{" "}
          <button type="button" className="underline" onClick={onRetryTemplate}>
            Try again
          </button>
        </p>
      ) : (
        <p className="text-2xs text-muted-foreground" data-testid="secure-foundation-template">
          {template
            ? `Installs ${template.repository}, branch ${template.branch}, at commit ${template.commit.slice(0, 7)} of ${template.committedAt.slice(0, 10)}.`
            : "Looking up the template's latest commit…"}
        </p>
      )}
      <div
        className="rounded-lg border border-border bg-muted/40 p-2.5"
        data-testid="secure-foundation-consent"
      >
        <p className="mb-1 text-xs font-medium">Pressing Go</p>
        <ul className="list-disc space-y-0.5 pl-4 text-2xs leading-snug">
          {consentSummary(answers, options.autonomy).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-1 text-2xs text-muted-foreground">
          Nothing is created before every check has passed.{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={onVerify}
          >
            Details
          </button>
        </p>
      </div>
      {/* Always in reach: the buttons stay at the bottom of the dialog while the rest scrolls. */}
      <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-popover px-4 py-3">
        {!provider && (
          <span className="mr-auto text-2xs text-muted-foreground">
            Sign an agent provider in under Settings › Providers first.
          </span>
        )}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy === "creating"}>
          Cancel
        </Button>
        <Button type="button" variant="outline" onClick={onVerify} disabled={busy !== null}>
          Verify Settings
        </Button>
        <GoButton type="submit" busy={busy} disabled={!ready} />
      </div>
    </form>
  );
}
