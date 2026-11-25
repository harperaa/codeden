import type { SecureFoundationRepoSecret, SecureFoundationRepoSecrets } from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useClient } from "@/lib/api";
import { secureFoundationRepoSecretsUrl } from "./copy";
import { Coded } from "./dev-preview-offer";
import { secureFoundationKey } from "./use-secure-foundation";

/**
 * The repository secrets and variables a Secure Foundation project's workflows use, and which
 * of them its GitHub repository has. `watch` changes when the answer may have (the setup's
 * phase, the project getting its repository), so it is asked again then. Undefined until it is
 * known; for any other project `applies` is false.
 */
export function useSecureFoundationRepoSecrets(projectId: string, enabled: boolean, watch: string) {
  const client = useClient();
  const queryKey = [...secureFoundationKey, "repository-secrets", projectId, watch];
  const query = useQuery({
    queryKey,
    queryFn: () => client.secureFoundation.repositorySecrets(projectId),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  return { data: query.data, queryKey };
}

/** True when the card has something to say about repository secrets. */
export function listsRepoSecrets(data: SecureFoundationRepoSecrets | undefined): boolean {
  return Boolean(data?.applies) && (data?.items.length ?? 0) + (data?.inherits.length ?? 0) > 0;
}

/**
 * True when a name is waiting for the person: the project has a repository, and a name its
 * workflows use isn't known to be set there. What keeps the card on the page of a project whose
 * setup is long over.
 */
export function awaitsRepoSecrets(data: SecureFoundationRepoSecrets | undefined): boolean {
  return (
    listsRepoSecrets(data) &&
    data?.github !== "no_repository" &&
    Boolean(data?.items.some((i) => i.state === "missing" || i.state === "unknown"))
  );
}

const names = (items: SecureFoundationRepoSecret[]) => items.map((i) => `\`${i.name}\``).join(", ");

const STATE: Record<"missing" | "unknown", string> = {
  missing: "not set",
  unknown: "couldn't check",
};

/** One name that isn't known to be set: what it is for, where it is used, and how to add it. */
function Entry({ item }: { item: SecureFoundationRepoSecret }) {
  return (
    <li data-testid="secure-foundation-secret" data-name={item.name} data-state={item.state}>
      <p>
        <code className="font-medium">{item.name}</code>{" "}
        <span
          className={
            item.state === "missing"
              ? "rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300"
              : "rounded-md bg-accent px-1.5 py-0.5"
          }
        >
          {item.kind === "variable" ? "variable, " : ""}
          {STATE[item.state === "missing" ? "missing" : "unknown"]}
        </span>
      </p>
      <div className="mt-1 space-y-0.5 text-muted-foreground">
        {item.purpose && (
          <p>
            <Coded text={item.purpose} />
          </p>
        )}
        <p>
          <span className="text-foreground">Used by:</span> <Coded text={item.where} />
        </p>
        <p>
          <Coded text={item.consequence} />
        </p>
      </div>
      {item.steps.length > 0 && (
        <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
          {item.steps.map((step) => (
            <li key={step}>
              <Coded text={step} />
            </li>
          ))}
        </ol>
      )}
      {item.source && (
        <p className="mt-1 text-muted-foreground">
          These steps are from{" "}
          <a href={item.source.url} target="_blank" rel="noreferrer" className="underline">
            {item.source.title}
          </a>
          .
        </p>
      )}
    </li>
  );
}

/**
 * On the project page's Secure Foundation card, beside the Clerk claim: the repository secrets
 * the project's workflows use that its repository doesn't have, each with what it is for and
 * the steps to add it. The person adds them, on GitHub or in their own terminal: nothing here
 * takes a value. Renders nothing when the workflows use none, and for any other project.
 */
export function SecureFoundationRepoSecretsList({
  projectId,
  data,
  queryKey,
}: {
  projectId: string;
  data: SecureFoundationRepoSecrets | undefined;
  /** The key `data` is cached under, so "Check again" replaces it. */
  queryKey: readonly unknown[];
}) {
  const client = useClient();
  const cache = useQueryClient();
  const again = useMutation({
    mutationFn: () => client.secureFoundation.checkRepositorySecrets(projectId),
    onSuccess: (fresh) => cache.setQueryData(queryKey, fresh),
  });
  if (!data || !listsRepoSecrets(data)) return null;
  const { items } = data;
  if (data.github === "no_repository") {
    if (items.length === 0) return null;
    return (
      <p className="mt-2 text-2xs" data-testid="secure-foundation-secrets">
        <span className="font-medium">Repository secrets:</span>{" "}
        <span className="text-muted-foreground">
          this project's workflows use <Coded text={names(items)} />. They matter once the project
          has a GitHub repository: GitHub copies none from a template, so you add them there. The
          steps appear here then.
        </span>
      </p>
    );
  }
  const open = items.filter((i) => i.state === "missing" || i.state === "unknown");
  const set = items.filter((i) => i.state === "set");
  const spared = items.filter((i) => i.state === "not_needed");
  const missing = open.filter((i) => i.state === "missing").length;
  return (
    <div className="mt-2 space-y-1.5 text-2xs" data-testid="secure-foundation-secrets">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">Repository secrets</span>
        <span className="text-muted-foreground" data-testid="secure-foundation-secrets-summary">
          {data.github === "unavailable"
            ? `${open.length} of the names this project's workflows use couldn't be checked in ${data.repository}.`
            : missing > 0
              ? `${missing} of the ${items.length} this project's workflows use ${missing === 1 ? "is" : "are"} not set in ${data.repository}.`
              : items.length > 0
                ? `Everything this project's workflows use is set in ${data.repository}, or not needed.`
                : ""}
        </span>
        {data.canCheck && (
          <button
            type="button"
            className="ml-auto underline underline-offset-2 hover:text-foreground disabled:opacity-60"
            onClick={() => again.mutate()}
            disabled={again.isPending}
            data-testid="secure-foundation-secrets-check"
          >
            {again.isPending ? "Checking…" : "Check again"}
          </button>
        )}
      </p>
      {data.message && (
        <p
          className="text-amber-700 dark:text-amber-300"
          data-testid="secure-foundation-secrets-problem"
        >
          <Coded text={data.message} />
        </p>
      )}
      {again.isError && (
        <p className="text-amber-700 dark:text-amber-300">
          Couldn't check again: {again.error instanceof Error ? again.error.message : "try again"}
        </p>
      )}
      {open.length > 0 && (
        <>
          <p className="text-muted-foreground">
            The project's GitHub workflows read these when they run on GitHub's servers; the app on
            this computer doesn't need them. GitHub copies no secret from a template, so you add the
            ones listed here yourself, on GitHub or in your own terminal. A value is never typed in
            here.
          </p>
          <ul className="space-y-2">
            {open.map((item) => (
              <Entry key={`${item.kind}:${item.name}`} item={item} />
            ))}
          </ul>
        </>
      )}
      {set.length > 0 && (
        <p className="text-muted-foreground" data-testid="secure-foundation-secrets-set">
          Already set: <Coded text={names(set)} />.
        </p>
      )}
      {spared.map((item) => (
        <p
          key={`${item.kind}:${item.name}`}
          className="text-muted-foreground"
          data-testid="secure-foundation-secrets-not-needed"
        >
          Not needed here: <code>{item.name}</code>. <Coded text={item.consequence} />
        </p>
      ))}
      {data.inherits.length > 0 && (
        <p className="text-muted-foreground" data-testid="secure-foundation-secrets-inherits">
          Inherits all:{" "}
          <Coded
            text={data.inherits.map((i) => `job \`${i.job}\` of \`${i.workflow}\``).join(", ")}
          />{" "}
          {data.inherits.length === 1 ? "hands" : "hand"} every repository secret to a workflow they
          call, which can use names that aren't listed here.
        </p>
      )}
      <p className="text-muted-foreground">
        {data.skipped > 0 &&
          `${data.skipped} workflow ${data.skipped === 1 ? "file was" : "files were"} not read (too many, too large or oddly named). `}
        {!data.canCheck && "Checked on the computer running the app; check again there. "}
        Read from the workflow files in the project folder and compared with the repository's own
        secrets; one your organisation shares or an environment holds isn't seen.{" "}
        <a
          href={secureFoundationRepoSecretsUrl()}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          About repository secrets
        </a>
      </p>
    </div>
  );
}
