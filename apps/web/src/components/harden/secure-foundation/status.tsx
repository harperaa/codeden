import {
  isSecureFoundationQuiet,
  isSecureFoundationSetup,
  type Project,
  SECURE_FOUNDATION_OPT_IN_MODE,
  SECURE_FOUNDATION_PROJECT_MODE,
  type SecureFoundationPhase,
  secureFoundationStatus,
} from "@codeden/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AutonomyDialog } from "@/components/factory/autonomy-dialog";
import { useClient } from "@/lib/api";
import { useSnapshot } from "@/lib/queries";
import { QUIET_MEANS, QUIET_TURN_ON } from "./consent";
import {
  secureFoundationDocsUrl,
  secureFoundationQuietUrl,
  secureFoundationRemovalUrl,
} from "./copy";
import { SecureFoundationDevPreviewLink } from "./dev-preview-offer";
import {
  awaitsRepoSecrets,
  SecureFoundationRepoSecretsList,
  useSecureFoundationRepoSecrets,
} from "./repo-secrets";
import { secureFoundationKey } from "./use-secure-foundation";

const LABEL: Record<SecureFoundationPhase, string> = {
  cloning: "Cloning",
  preparing: "Checking this computer",
  installing: "Installing",
  waiting: "Waiting on you",
  running: "Running",
  stopped: "Stopped",
  failed: "Failed",
};

const HINT: Partial<Record<SecureFoundationPhase, string>> = {
  waiting: "The setup session has a question or something for you to read.",
  stopped:
    'The setup session ended, so the app\'s processes are gone. Open the session and send "start the app", or run the two dev commands in a terminal in the project folder.',
  failed: 'Open the setup session to see what went wrong; sending "continue" there resumes it.',
};

/**
 * A project's "Secure Foundation setup" status: derived from its setup session, with the app's
 * URL while that session's processes run. While the project is quiet (`isSecureFoundationQuiet`)
 * it says that automatic work is off and opens the autonomy dialog to turn it on. The snapshot
 * drops a setup session some time after it is archived; the server still keeps such a project
 * quiet, so a project in the quiet mode without a setup session here is asked about, and the
 * notice stays, with the way to the dev preview's settings. Once the setup is over it also lists
 * the repository secrets the project's workflows use that its repository doesn't have, beside
 * the Clerk claim. While one of them is still missing the card stays, whatever the project's
 * mode and after the setup session is gone. Renders nothing for any other project.
 */
export function SecureFoundationStatus({ projectId }: { projectId: string }) {
  const client = useClient();
  const { data } = useSnapshot();
  const project = data?.projects.find((p) => p.id === projectId);
  const session = (data?.sessions ?? [])
    .filter((s) => s.projectId === projectId && isSecureFoundationSetup(s))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const status = session ? secureFoundationStatus(session) : null;
  const finished = status?.phase === "running" || status?.phase === "stopped";
  const finish = useQuery({
    queryKey: [...secureFoundationKey, "finish", projectId, status?.phase],
    queryFn: () => client.secureFoundation.finish(projectId),
    enabled: Boolean(session) && finished,
    gcTime: 0,
  });
  const inQuietMode = project?.autonomyMode === SECURE_FOUNDATION_PROJECT_MODE;
  const asked = useQuery({
    queryKey: [...secureFoundationKey, "quiet", projectId],
    queryFn: () => client.secureFoundation.quiet(projectId),
    enabled: Boolean(data) && inQuietMode && !session,
  });
  const over = finished || status?.phase === "failed";
  // Asked again when the setup moves on and when the project gets its GitHub repository.
  const repository =
    project?.kind === "github" ? `${project.github.owner}/${project.github.repo}` : "";
  const secrets = useSecureFoundationRepoSecrets(
    projectId,
    Boolean(project) && (!session || over),
    `${status?.phase ?? "none"} ${repository}`,
  );
  const secretsList = (
    <SecureFoundationRepoSecretsList
      projectId={projectId}
      data={secrets.data}
      queryKey={secrets.queryKey}
    />
  );
  if (!project) return null;
  if (!session || !status) {
    const quietNow = inQuietMode && asked.data?.quiet === true;
    if (!quietNow && !awaitsRepoSecrets(secrets.data)) return null;
    return (
      <section
        className="rounded-xl border border-border p-3 text-xs"
        aria-label="Secure Foundation setup"
        data-testid="secure-foundation-status"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <span className="font-medium">Secure Foundation setup</span>
        </div>
        {quietNow && <QuietNotice project={project} />}
        {/* The setup session is gone, so the setup is over: the way to the dev preview stays. */}
        <SecureFoundationDevPreviewLink projectId={projectId} />
        {secretsList}
      </section>
    );
  }
  const claim = finish.data?.clerkClaimUrl;
  const quiet = isSecureFoundationQuiet(project, [session]);
  return (
    <section
      className="rounded-xl border border-border p-3 text-xs"
      aria-label="Secure Foundation setup"
      data-testid="secure-foundation-status"
      data-phase={status.phase}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <span className="font-medium">Secure Foundation setup</span>
        <span className="rounded-md bg-accent px-1.5 py-0.5 text-2xs">
          {LABEL[status.phase]}
          {status.url ? " at " : ""}
          {status.url && (
            <a
              href={status.url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {status.url}
            </a>
          )}
        </span>
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: session.id }}
          className="ml-auto text-2xs text-muted-foreground hover:text-foreground"
        >
          Open the setup session →
        </Link>
      </div>
      {status.phase === "running" && (
        <p className="mt-1.5 text-2xs text-muted-foreground">
          The URL only works while the setup session's processes are running. Stop the app by
          stopping that session.{" "}
          <a
            href={secureFoundationDocsUrl()}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Stopping, restarting and removing
          </a>
        </p>
      )}
      {HINT[status.phase] && (
        <p className="mt-1.5 text-2xs text-muted-foreground">{HINT[status.phase]}</p>
      )}
      {quiet && <QuietNotice project={project} />}
      {finish.data?.deployedUrl && (
        <p className="mt-2 text-2xs" data-testid="secure-foundation-deployed">
          <span className="font-medium">Deployed (dev):</span>{" "}
          <a
            href={finish.data.deployedUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {finish.data.deployedUrl}
          </a>{" "}
          <span className="text-muted-foreground">
            Public, on the development Clerk and Convex. It stays up when the setup session stops.
          </span>
        </p>
      )}
      {finished && <SecureFoundationDevPreviewLink projectId={projectId} />}
      {over && (
        <p className="mt-2 text-2xs text-muted-foreground" data-testid="secure-foundation-created">
          The setup session's first message lists everything it was allowed to create in your
          accounts, with where to remove each item; when it ran to the end, its last message says
          what was actually created. Archiving the project or deleting its folder removes none of
          it.{" "}
          <a
            href={secureFoundationRemovalUrl()}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Removing the project
          </a>
        </p>
      )}
      {claim && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-2xs">
          <a
            href={claim}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium hover:bg-accent/40"
            data-testid="secure-foundation-claim"
          >
            Claim your Clerk app <ExternalLink className="size-3" />
          </a>
          <span className="text-muted-foreground">
            Click Claim only, and skip the setup checklist on that page: the install already did all
            of it.
          </span>
        </p>
      )}
      {over && secretsList}
    </section>
  );
}

/** That automatic work is off in this project, what that means and the way to turn it on. */
function QuietNotice({ project }: { project: Project }) {
  const [choosingMode, setChoosingMode] = useState(false);
  return (
    <>
      <p className="mt-2 text-2xs" data-testid="secure-foundation-quiet">
        <span className="font-medium">Automatic work is off.</span>{" "}
        <span className="text-muted-foreground">
          This project is in Manual mode, as Secure Foundation creates it: nothing starts in it by
          itself. {QUIET_MEANS}; what arrives meanwhile is kept for the project manager's next turn.{" "}
          {QUIET_TURN_ON}.
        </span>{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={() => setChoosingMode(true)}
          data-testid="secure-foundation-turn-on"
        >
          Turn on automatic work…
        </button>{" "}
        <a
          href={secureFoundationQuietUrl()}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground underline underline-offset-2"
        >
          What this changes
        </a>
      </p>
      {choosingMode && (
        <AutonomyDialog
          project={project}
          open
          onOpenChange={setChoosingMode}
          initialMode={SECURE_FOUNDATION_OPT_IN_MODE}
        />
      )}
    </>
  );
}
