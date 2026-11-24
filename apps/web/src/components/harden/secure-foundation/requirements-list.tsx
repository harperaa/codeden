import {
  SECURE_FOUNDATION_ACCOUNTS,
  SECURE_FOUNDATION_TOOLS,
  type SecureFoundationAccountRequirement,
  type SecureFoundationRequirements,
  type SecureFoundationService,
  type SecureFoundationToolCheck,
  secureFoundationTool,
} from "@codeden/contracts";
import { Copy, ExternalLink, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyWithFeedback } from "@/lib/copy";
import { LoginProgress } from "./connections";
import { LaterAccountRow } from "./requirements-later-row";
import { openPage, Retry, Row, type RowState } from "./requirements-row";
import { useServiceLogin } from "./use-login";

/**
 * What Secure Foundation needs, as two lists in the format of the first-run checklist: the
 * tools on this computer, and the accounts. Both come from the one list in the contracts
 * (`SECURE_FOUNDATION_TOOLS`, `SECURE_FOUNDATION_ACCOUNTS`). Nothing here asks for, shows or
 * keeps a token: a missing tool gets its install command to copy, a service a button to its own
 * pages, and a sign-in is the service's own, started as the verification view starts it.
 */

function ToolRow({
  check,
  os,
  checking,
  onCheck,
}: {
  check: SecureFoundationToolCheck;
  os: SecureFoundationRequirements["platform"] | undefined;
  checking: boolean;
  onCheck: () => void;
}) {
  const tool = secureFoundationTool(check.id);
  const absent = check.state === "missing" || check.state === "outdated";
  const state: RowState = checking
    ? "checking"
    : absent
      ? "missing"
      : check.state === "unknown" && check.found !== true
        ? "warning"
        : "ok";
  const command = os ? tool.install[os] : null;
  return (
    <Row
      id={tool.id}
      state={state}
      label={tool.label}
      neededFor={tool.neededFor}
      message={
        state === "ok"
          ? `${check.version ? `Version ${check.version}. ` : "Installed. "}${tool.why}`
          : `${check.message} ${tool.why}`
      }
      actions={
        absent ? (
          <>
            {command && (
              <Button
                size="xs"
                variant="ghost"
                className="min-w-0 max-w-56 shrink font-mono text-muted-foreground"
                title={command}
                onClick={() => void copyWithFeedback(command, "Command copied")}
              >
                <Copy /> <span className="truncate">{command}</span>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => openPage(tool.installUrl)}>
              <ExternalLink /> Install guide
            </Button>
          </>
        ) : state === "warning" ? (
          <Retry onCheck={onCheck} />
        ) : null
      }
    >
      {absent && command ? (
        <p className="mt-1 text-2xs text-muted-foreground">
          Run it yourself in a terminal (it can ask for your password), then check again.
        </p>
      ) : null}
    </Row>
  );
}

const ACCOUNT_LINE =
  "Creating an account is all you need to do there. Secure Foundation does the rest.";

/** A service the setup signs in to: its sign-in is held by a tool on this computer. */
function ServiceRow({
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
  const tool = secureFoundationTool(check.id);
  const state: RowState = checking
    ? "checking"
    : check.state === "ok"
      ? "ok"
      : check.state === "needs_sign_in" || check.state === "missing"
        ? "missing"
        : "warning";
  const message =
    check.state === "ok"
      ? `Signed in on this computer. ${account.why}`
      : check.state === "missing" && tool.program
        ? `Install the ${tool.label} first (above), then check again. ${account.why}`
        : `${check.message} ${account.why}`;
  const canSignIn = check.state === "needs_sign_in" || check.state === "needs_permission";
  return (
    <Row
      id={`account-${account.id}`}
      state={state}
      label={account.label}
      neededFor={account.neededFor}
      message={message}
      actions={
        check.state === "ok" ? null : (
          <>
            {check.state !== "needs_permission" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openPage(account.url)}
                data-testid={`create-account-${account.id}`}
              >
                <ExternalLink /> Create an account
              </Button>
            )}
            {check.state === "unknown" && <Retry onCheck={onCheck} />}
            {canSignIn && !running && (
              <Button size="sm" onClick={start}>
                <LogIn /> {check.state === "needs_permission" ? "Add the permission" : "Sign in"}
              </Button>
            )}
            {running && (
              <Button size="sm" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            )}
          </>
        )
      }
    >
      {check.state !== "ok" && check.state !== "needs_permission" && (
        <p className="mt-1 text-2xs text-muted-foreground">
          No {account.label} account yet? {ACCOUNT_LINE}
          {check.state === "needs_sign_in"
            ? " Then sign in here: it opens the service's own sign-in page."
            : ""}
        </p>
      )}
      <LoginProgress label={account.label} login={login} />
      {error && (
        <p className="mt-1 text-2xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </Row>
  );
}

const LIST = "divide-y divide-border overflow-hidden rounded-xl border border-border bg-card";

export function RequirementsList({
  result,
  checking,
  onCheck,
}: {
  /** The last check; undefined while the first one runs. */
  result: SecureFoundationRequirements | undefined;
  checking: boolean;
  onCheck: () => void;
}) {
  const pending = checking || !result;
  const of = (id: SecureFoundationToolCheck["id"]): SecureFoundationToolCheck =>
    result?.tools.find((t) => t.id === id) ?? {
      id,
      state: "unknown",
      found: null,
      version: null,
      signedIn: null,
      message: `${secureFoundationTool(id).label} couldn't be checked.`,
    };
  return (
    <div className="space-y-4" data-testid="secure-foundation-requirements-list">
      <section>
        <h3 className="mb-1.5 text-xs font-medium">Tools on this computer</h3>
        <div className={LIST}>
          {SECURE_FOUNDATION_TOOLS.filter((t) => t.program !== null).map((t) => (
            <ToolRow
              key={t.id}
              check={of(t.id)}
              os={result?.platform}
              checking={pending}
              onCheck={onCheck}
            />
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-1.5 text-xs font-medium">Accounts</h3>
        <div className={LIST}>
          {SECURE_FOUNDATION_ACCOUNTS.map((account) => {
            const service = secureFoundationTool(account.tool).service;
            if (!service) return null;
            const AccountRow = account.neededFor === "later" ? LaterAccountRow : ServiceRow;
            return (
              <AccountRow
                key={account.id}
                account={account}
                service={service}
                check={of(account.tool)}
                checking={pending}
                onCheck={onCheck}
              />
            );
          })}
        </div>
        <p className="mt-2 text-2xs text-muted-foreground">
          Checked on this computer, by asking each tool. No token or password is asked for, shown or
          kept here: every service keeps its own sign-in.
        </p>
      </section>
    </div>
  );
}
