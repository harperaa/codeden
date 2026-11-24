import {
  SECURE_FOUNDATION_ACCOUNTS,
  SECURE_FOUNDATION_TOOLS,
  type SecureFoundationAccountRequirement,
  type SecureFoundationNeededFor,
  type SecureFoundationRequirements,
  type SecureFoundationService,
  type SecureFoundationToolCheck,
  secureFoundationTool,
} from "@codeden/contracts";
import { Copy, ExternalLink, Info, LogIn, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { StateIcon } from "@/components/setup/checklist";
import { Button } from "@/components/ui/button";
import { copyWithFeedback } from "@/lib/copy";
import { platform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { LoginProgress } from "./connections";
import { useServiceLogin } from "./use-login";

/**
 * What Secure Foundation needs, as two lists in the format of the first-run checklist: the
 * tools on this computer, and the accounts. Both come from the one list in the contracts
 * (`SECURE_FOUNDATION_TOOLS`, `SECURE_FOUNDATION_ACCOUNTS`). Nothing here asks for, shows or
 * keeps a token: a missing tool gets its install command to copy, a service a button to its own
 * pages, and a sign-in is the service's own, started as the verification view starts it.
 */

type Icon = "checking" | "ok" | "warning" | "missing" | "info";

const ONLY_FOR: Record<SecureFoundationNeededFor, string | null> = {
  always: null,
  doppler: "only with secrets in Doppler",
  deploy: "only for the Deploy option",
};

function RowIcon({ state }: { state: Icon }) {
  if (state !== "info") return <StateIcon state={state} />;
  // Not a pass and not a fail: nothing on this computer can tell.
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Info className="size-3.5" />
    </span>
  );
}

function Row({
  id,
  state,
  label,
  neededFor,
  message,
  actions,
  children,
}: {
  id: string;
  state: Icon;
  label: string;
  neededFor: SecureFoundationNeededFor;
  message: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const failed = state === "missing";
  return (
    <div className="px-4 py-3" data-requirement={id} data-state={state}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:flex-nowrap">
        <RowIcon state={state} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13.5px] font-medium">
            {label}
            {ONLY_FOR[neededFor] ? (
              <span className="text-3xs font-normal text-muted-foreground">
                {ONLY_FOR[neededFor]}
              </span>
            ) : null}
          </div>
          <div
            className={cn(
              "text-2xs break-words",
              failed ? "text-status-failed/90" : "text-muted-foreground",
            )}
          >
            {state === "checking" ? "Checking…" : message}
          </div>
        </div>
        {actions && state !== "checking" && (
          <div className="flex min-w-0 basis-full flex-wrap items-center gap-1.5 pl-9 sm:basis-auto sm:pl-0">
            {actions}
          </div>
        )}
      </div>
      {state !== "checking" && children ? <div className="pl-9">{children}</div> : null}
    </div>
  );
}

const open = (url: string) => platform.openExternal(url);

function Retry({ onCheck }: { onCheck: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onCheck}>
      <RefreshCw /> Retry
    </Button>
  );
}

function ToolRow({
  check,
  os,
  checking,
  onCheck,
}: {
  check: SecureFoundationToolCheck | undefined;
  os: SecureFoundationRequirements["platform"] | undefined;
  checking: boolean;
  onCheck: () => void;
}) {
  if (!check) return null;
  const tool = secureFoundationTool(check.id);
  const absent = check.state === "missing" || check.state === "outdated";
  const state: Icon = checking
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
            <Button size="sm" variant="outline" onClick={() => open(tool.installUrl)}>
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

function CreateAccount({ account }: { account: SecureFoundationAccountRequirement }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => open(account.url)}
      data-testid={`create-account-${account.id}`}
    >
      <ExternalLink /> Create an account
    </Button>
  );
}

/** A service whose sign-in a tool on this computer holds. */
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
  const state: Icon = checking
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
            {check.state !== "needs_permission" && <CreateAccount account={account} />}
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
            const service = account.tool ? secureFoundationTool(account.tool).service : undefined;
            if (account.tool && service) {
              return (
                <ServiceRow
                  key={account.id}
                  account={account}
                  service={service}
                  check={of(account.tool)}
                  checking={pending}
                  onCheck={onCheck}
                />
              );
            }
            // No tool on this computer can tell: said as it is, never as a pass or a fail.
            return (
              <Row
                key={account.id}
                id={`account-${account.id}`}
                state="info"
                label={account.label}
                neededFor={account.neededFor}
                message={`${account.why} It can't be checked from here.`}
                actions={<CreateAccount account={account} />}
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
