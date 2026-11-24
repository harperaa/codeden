import {
  type ConvexTeam,
  isLoginRunning,
  type SecureFoundationConnection,
  type SecureFoundationLogin,
  type SecureFoundationService,
} from "@codeden/contracts";
import { ExternalLink, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useServiceLogin } from "./use-login";

const LABEL: Record<SecureFoundationService, string> = {
  convex: "Convex",
  doppler: "Doppler",
  github: "GitHub",
  vercel: "Vercel",
  clerk: "Clerk",
};

/**
 * One service's sign-in, asked of the service's own command-line tool: its state, the button
 * that starts its login, and the login's link and code while one runs. Nothing of a sign-in is
 * read or kept here.
 */
export function ConnectionRow({
  connection,
  icon,
  status,
  message,
  fix,
  onChanged,
}: {
  connection: SecureFoundationConnection;
  /** The check's mark (passed, needs you, failed) and its state. */
  icon: ReactNode;
  status: string;
  /** What the check found: the tool's answer, and anything the check adds to it. */
  message: string;
  /** What to do about it, when it didn't pass. */
  fix: string | null;
  /** A login ended: the checks are worth running again. */
  onChanged: () => void;
}) {
  const { service } = connection;
  const { login, error, running, start, cancel } = useServiceLogin(service, onChanged);
  return (
    <li
      className="rounded-lg border border-border p-2.5"
      data-testid={`connection-${service}`}
      data-status={status}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[13px] font-medium">{LABEL[service]}</span>
        <span className="text-2xs text-muted-foreground">{message}</span>
        {connection.signedIn === true && connection.missingScopes.length > 0 && !running && (
          <Button size="sm" className="ml-auto" onClick={start}>
            Add the {connection.missingScopes.join(", ")} permission
          </Button>
        )}
        {connection.cli === "ready" && connection.signedIn === false && !running && (
          <Button size="sm" className="ml-auto" onClick={start}>
            Sign in to {LABEL[service]}
          </Button>
        )}
        {running && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
      {connection.cli === "missing" && connection.install && (
        <p className="mt-1.5 text-2xs text-muted-foreground">
          Install it yourself in a terminal (it can ask for your password), then check again:{" "}
          <code className="rounded bg-accent px-1 py-0.5">{connection.install}</code>
        </p>
      )}
      <LoginProgress label={LABEL[service]} login={login} />
      {fix && !running && <p className="mt-1.5 text-2xs">{fix}</p>}
      {error && (
        <p className="mt-1.5 text-2xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** A login while it runs or after it failed: what it says, and its link and code. */
export function LoginProgress({
  label,
  login,
}: {
  label: string;
  login: SecureFoundationLogin | null;
}) {
  if (!login || login.status === "done") return null;
  return (
    <div className="mt-1.5 space-y-1 text-2xs" role="status">
      <p className="flex items-center gap-1.5 text-muted-foreground">
        {isLoginRunning(login) && <Loader2 className="size-3 animate-spin" />}
        {login.message}
      </p>
      {login.url && (
        <p>
          <a
            href={login.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
          >
            Open the {label} sign-in page <ExternalLink className="size-3" />
          </a>
          {login.code && (
            <>
              {" "}
              The page should show the code{" "}
              <code className="rounded bg-accent px-1 py-0.5">{login.code}</code>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** With several Convex teams: the one the project is created in. */
export function ConvexTeamField({
  teams,
  value,
  onChange,
}: {
  teams: ConvexTeam[];
  value: string | undefined;
  onChange: (slug: string) => void;
}) {
  if (teams.length < 2) return null;
  return (
    <label className="block space-y-1.5 text-xs">
      <span className="font-medium">Convex team</span>
      <select
        value={value ?? teams[0]?.slug ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[13px]"
      >
        {teams.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.name} ({t.slug})
          </option>
        ))}
      </select>
      <span className="block text-2xs text-muted-foreground">
        The Convex project is created in this team.
      </span>
    </label>
  );
}
