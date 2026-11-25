import type { SecureFoundationOptions, SecureFoundationTemplate } from "@codeden/contracts";
import { Check, CircleAlert, CircleX, Loader2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { type FormAnswers, modulesOf } from "./answers";
import { ConnectionRow, ConvexTeamField } from "./connections";
import { CREATED_STAYS, consentStatements, createsOf } from "./consent";
import { deployOf } from "./deploy";
import { DeployFields } from "./deploy-fields";
import { GoButton } from "./go-button";
import type { Go } from "./use-go";
import { type CheckItem, failuresFirst } from "./verify";

const STATUS = { passed: "Passed", needs_you: "Needs you", failed: "Failed" } as const;

function StatusIcon({ status }: { status: CheckItem["status"] }) {
  const Icon = status === "passed" ? Check : status === "failed" ? CircleX : CircleAlert;
  const colour =
    status === "passed"
      ? "text-status-done"
      : status === "failed"
        ? "text-status-failed"
        : "text-status-waiting";
  return (
    <>
      <Icon className={`size-4 shrink-0 ${colour}`} aria-hidden />
      <span className="sr-only">{STATUS[status]}:</span>
    </>
  );
}

function CheckRow({ item }: { item: CheckItem }) {
  return (
    <li
      className="rounded-lg border border-border p-2.5"
      data-testid={`check-${item.id}`}
      data-status={item.status}
    >
      <div className="flex items-start gap-2">
        <span className="mt-px flex">
          <StatusIcon status={item.status} />
        </span>
        <span className="text-[13px] font-medium whitespace-nowrap">{item.label}</span>
        <span className="text-2xs leading-5 text-muted-foreground">{item.message}</span>
      </div>
      {item.fix && <p className="mt-1.5 text-2xs">{item.fix}</p>}
    </li>
  );
}

/**
 * The verification view: everything Go checks, each passed, needing the person or failed with
 * what to do about it (the sign-in rows keep their login buttons), then what happens and what
 * is created in the person's accounts. Opened with Verify Settings or Details, and where a Go
 * that created nothing lands.
 */
export function VerifyStep({
  options,
  template,
  answers,
  onChange,
  go,
  stopped,
  onGo,
  onBack,
  onCancel,
}: {
  options: SecureFoundationOptions;
  template: SecureFoundationTemplate | undefined;
  answers: FormAnswers;
  onChange: Dispatch<SetStateAction<FormAnswers>>;
  go: Go;
  /** Arrived from a Go that created nothing: what stopped it comes first. */
  stopped: boolean;
  onGo: () => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const result = go.result;
  const items = result ? (stopped ? failuresFirst(result.items) : result.items) : [];
  const open = items.filter((i) => i.status !== "passed");
  const of = (service: string) => items.find((i) => i.id === service)?.connection;
  const teams = of("convex")?.teams ?? [];
  const provider = options.providers.find((p) => p.id === answers.provider);
  const input = {
    ...options,
    name: answers.name.trim(),
    secrets: answers.secrets,
    convexTeam: answers.convexTeam,
    deploy: deployOf(answers) ?? undefined,
  };
  const set = (next: FormAnswers) => onChange(next);

  return (
    <div className="space-y-4" data-testid="secure-foundation-verify">
      {stopped && result && open.length > 0 && (
        <p
          className="rounded-lg border border-status-waiting/40 bg-status-waiting/10 p-2.5 text-xs"
          role="alert"
          data-testid="secure-foundation-stopped"
        >
          Go stopped before anything was created: {open.length === 1 ? "one check" : "some checks"}{" "}
          below {open.length === 1 ? "needs" : "need"} you. Put {open.length === 1 ? "it" : "them"}{" "}
          right here, then press Go again.
        </p>
      )}
      <div>
        <h3 className="mb-1 text-xs font-medium">What Go checks</h3>
        <p className="text-2xs text-muted-foreground">
          All of this is checked every time you press Go, before anything is created. The sign-ins
          are asked of each service's own command-line tool: nothing of them is read or kept here.
        </p>
      </div>
      {!result && (
        <p className="flex items-center gap-1.5 text-2xs text-muted-foreground" role="status">
          <Loader2 className="size-3 animate-spin" /> Checking… asking each tool can take a minute
          the first time.
        </p>
      )}
      <ul className="space-y-2">
        {items.map((item) =>
          item.connection ? (
            <ConnectionRow
              key={item.id}
              connection={item.connection}
              status={item.status}
              message={item.message}
              icon={<StatusIcon status={item.status} />}
              fix={item.fix}
              onChanged={() => void go.check()}
            />
          ) : (
            <CheckRow key={item.id} item={item} />
          ),
        )}
      </ul>
      {/* The choices Go is working on can't be edited while it checks or creates. */}
      <fieldset disabled={go.busy !== null} className="min-w-0 space-y-4 disabled:opacity-70">
        <ConvexTeamField
          teams={teams}
          value={answers.convexTeam}
          onChange={(convexTeam) => onChange((a) => ({ ...a, convexTeam }))}
        />
        {answers.deploy && (
          <DeployFields
            github={of("github")}
            vercel={of("vercel")}
            answers={answers}
            onChange={set}
          />
        )}
      </fieldset>
      {template && provider ? (
        <div>
          <h3 className="mb-1.5 text-xs font-medium">What happens when you press Go</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-xs leading-snug">
            {consentStatements({
              ...input,
              modules: modulesOf(answers, template),
              provider,
              template,
            }).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-2xs text-muted-foreground">
          What happens is listed here once the template's commit and a provider are known.
        </p>
      )}
      <div>
        <h3 className="mb-1.5 text-xs font-medium">What is created in your accounts</h3>
        <ul className="space-y-1.5 text-xs leading-snug" data-testid="secure-foundation-creates">
          {createsOf(answers).map((c) => (
            <li key={c.service}>
              <span className="font-medium">{c.service}:</span> {c.item}.{" "}
              <span className="text-muted-foreground">Remove it in {c.removeAt}.</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-2xs text-muted-foreground">{CREATED_STAYS}</p>
      </div>
      {/* Always in reach: the buttons stay at the bottom of the dialog while the rest scrolls. */}
      <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-popover px-4 py-3">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={go.busy === "creating"}>
          Cancel
        </Button>
        <Button type="button" variant="outline" onClick={onBack} disabled={go.busy !== null}>
          Back to the form
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void go.check()}
          disabled={go.busy !== null}
        >
          Check again
        </Button>
        <GoButton busy={go.busy} onClick={onGo} />
      </div>
    </div>
  );
}
