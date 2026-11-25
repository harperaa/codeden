import type { SecureFoundationConnection } from "@codeden/contracts";
import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import type { FormAnswers } from "./answers";
import { deployOf, selectedOwner, suggestedRepository } from "./deploy";

const SELECT = "h-8 w-full rounded-md border border-input bg-transparent px-2 text-[13px]";

/**
 * Where the deploy goes, filled in from the two sign-ins: the repository's owner (the account
 * first, then its organisations; the last deploy's owner is preselected when it is one of them),
 * its name, and the Vercel scope. Shown once both are signed in.
 */
export function DeployFields({
  github,
  vercel,
  answers,
  onChange,
}: {
  github: SecureFoundationConnection | undefined;
  vercel: SecureFoundationConnection | undefined;
  answers: FormAnswers;
  onChange: (next: FormAnswers) => void;
}) {
  const owners = github?.owners ?? [];
  const scopes = vercel?.scopes ?? [];
  const owner = selectedOwner(github, answers.deployOwner);
  const scope = scopes.some((s) => s.slug === answers.deployScope)
    ? answers.deployScope
    : scopes[0]?.slug;
  // The last deploy's owner (else the personal account) and the first (or only) scope are preselected.
  useEffect(() => {
    if (owner !== answers.deployOwner || scope !== answers.deployScope) {
      onChange({ ...answers, deployOwner: owner, deployScope: scope });
    }
  }, [owner, scope, answers, onChange]);
  if (github?.signedIn !== true || vercel?.signedIn !== true) return null;
  const repository = answers.deployRepository ?? suggestedRepository(answers);
  const valid = deployOf({ ...answers, deployOwner: owner, deployScope: scope }) !== null;
  return (
    <div className="space-y-3 rounded-lg border border-border p-2.5" data-testid="deploy-fields">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-xs">
          <span className="font-medium">Repository owner</span>
          <select
            value={owner ?? ""}
            onChange={(e) => onChange({ ...answers, deployOwner: e.target.value })}
            className={SELECT}
          >
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
                {o === github.account ? " (your account)" : ""}
                {o === github.lastOwner && o !== github.account ? " (used last time)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-xs" htmlFor="sf-repository">
          <span className="font-medium">Repository name</span>
          <Input
            id="sf-repository"
            value={repository}
            onChange={(e) => onChange({ ...answers, deployRepository: e.target.value })}
            maxLength={100}
          />
        </label>
      </div>
      <label className="block space-y-1 text-xs" htmlFor="sf-scope">
        <span className="font-medium">Vercel scope</span>
        {scopes.length > 0 ? (
          <select
            value={scope ?? ""}
            id="sf-scope"
            onChange={(e) => onChange({ ...answers, deployScope: e.target.value })}
            className={SELECT}
          >
            {scopes.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name} ({s.slug})
              </option>
            ))}
          </select>
        ) : (
          <span className="block text-2xs text-amber-600 dark:text-amber-400">
            Vercel listed no team for this account. Create one on Vercel, then check again.
          </span>
        )}
      </label>
      <p className="text-2xs text-muted-foreground" data-testid="deploy-owner-secrets">
        A repository in an organisation gets the secrets that organisation shares with its
        repositories, such as a token for the template's Claude reviews. A repository under your own
        account gets none of those: you add each one to it yourself.
      </p>
      <p className="text-2xs text-muted-foreground">
        The repository is created <span className="font-medium">private</span>, as {owner}/
        {repository}, and the Vercel project takes the same name. A repository or project of that
        name that already exists is refused when the setup starts: nothing is pushed into it.
        {!valid && repository ? " That name can't be used for a repository." : ""}
      </p>
    </div>
  );
}
