import {
  type SecureFoundationAccountRequirement,
  type SecureFoundationService,
  type SecureFoundationToolCheck,
  secureFoundationTool,
} from "@codeden/contracts";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSecureFoundationAccounts } from "./account-store";
import { LoginProgress } from "./connections";
import { openPage, Retry, Row } from "./requirements-row";
import { useServiceLogin } from "./use-login";

/**
 * An account no setup needs but the person does afterwards (Clerk, to claim the app the install
 * created without one). Its tool is asked like the others, and signed in is a green check. Not
 * signed in is not a failure: "Create or Sign-in" starts the tool's own login, which opens the
 * service's page, where a new person can create the account. The tool can also answer "not
 * signed in" when it merely can't read its saved sign-in (a locked keychain), so the person can
 * say "I have an account" instead; that yes is kept in this browser only.
 */
export function LaterAccountRow({
  account,
  service,
  check,
  checking,
  onCheck,
}: {
  account: SecureFoundationAccountRequirement;
  service: SecureFoundationService;
  check: SecureFoundationToolCheck;
  checking: boolean;
  onCheck: () => void;
}) {
  const { login, error, running, start, cancel } = useServiceLogin(service, onCheck);
  const said = useSecureFoundationAccounts((s) => s.confirmed[account.id] === true);
  const setConfirmed = useSecureFoundationAccounts((s) => s.setConfirmed);
  const { label } = account;
  const after = account.after ?? account.why;
  const signedIn = check.state === "ok";
  // The command the check ran, so "not signed in" can be compared with what the person ran.
  const pinned = secureFoundationTool(check.id).npxPackage;
  const asked = pinned ? `npx ${pinned} whoami` : null;
  // Without npx the tool's login can't be started: the button opens the service's page instead.
  const canStart = check.state !== "missing";
  const message = signedIn
    ? `Signed in on this computer. ${after}`
    : said
      ? `You said you have a ${label} account. ${after}`
      : check.state === "needs_sign_in"
        ? `Sign in so your ${label} account is ready to claim your app after the install.`
        : `${label}'s sign-in couldn't be checked from this computer. Having an account is all that's needed: ${after.charAt(0).toLowerCase()}${after.slice(1)}`;
  return (
    <Row
      id={`account-${account.id}`}
      state={checking ? "checking" : signedIn || said ? "ok" : "info"}
      label={label}
      neededFor={account.neededFor}
      message={message}
      actions={
        signedIn ? null : said ? (
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setConfirmed(account.id, false)}
            data-testid={`undo-account-${account.id}`}
          >
            Undo
          </Button>
        ) : (
          <>
            {check.state === "unknown" && <Retry onCheck={onCheck} />}
            {running ? (
              <Button size="sm" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={canStart ? start : () => openPage(account.url)}
                data-testid={`create-account-${account.id}`}
              >
                <ExternalLink /> Create or Sign-in
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmed(account.id, true)}
              data-testid={`have-account-${account.id}`}
            >
              I have an account
            </Button>
          </>
        )
      }
    >
      {!signedIn && !said && (
        <p className="mt-1 text-2xs text-muted-foreground">
          Nothing here holds the setup back: the install creates your app without an account.
          Signing in uses {label}'s own command-line tool, which opens {label}'s page in your
          browser; for a new account it can also create a first application there.
        </p>
      )}
      {!signedIn && !said && check.state === "needs_sign_in" && asked && (
        <p className="mt-1 text-2xs text-muted-foreground" data-testid={`asked-${account.id}`}>
          What was asked just now: <code className="rounded bg-accent px-1 py-0.5">{asked}</code>,
          outside any project folder, answered that it is not logged in on this computer. Being
          signed in to {label} in your browser is not this sign-in, and the same command can pass
          inside a project folder that holds an app's keys without any account being signed in.
        </p>
      )}
      {!signedIn && !said && <LoginProgress label={label} login={login} />}
      {error && !signedIn && !said && (
        <p className="mt-1 text-2xs" role="alert">
          {error}{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => openPage(account.url)}
          >
            Open {label}'s sign-in page instead
          </button>
        </p>
      )}
    </Row>
  );
}
