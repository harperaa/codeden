import type { Project } from "@codeden/contracts";
import { Link } from "@tanstack/react-router";
import { MonitorPlay } from "lucide-react";
import { devPreviewSettingsHref } from "@/components/harden/dev-preview/setup";
import { DevPreviewSettingsExample, DevPreviewSwitchExample } from "./examples";

/** As the strip says it on another device. */
export const DEV_SERVERS_REMOTE = "Previews are started on the computer running the app.";

/** The pointer that stays on the page once something is listed. */
export function DevServersHint({ remote }: { remote: boolean }) {
  return (
    <p className="text-2xs text-muted-foreground" data-testid="dev-servers-hint">
      {remote
        ? `${DEV_SERVERS_REMOTE} From this device you can watch and stop them.`
        : "Switch a preview on at the top of a PM or session page. This page watches and stops them."}
    </p>
  );
}

const link = "font-medium underline underline-offset-2 hover:text-foreground";
/** With more projects than this, the rest are found in the sidebar. */
const LISTED = 8;

/** Where a preview is switched on and set up, per project: its PM page and its settings. */
function ProjectLinks({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return (
      <p data-testid="dev-servers-no-projects">
        There is no project yet, and a project comes first: add one in the sidebar, then set up its
        dev preview.
      </p>
    );
  }
  return (
    <>
      <p>Your projects:</p>
      <ul className="mt-1.5 space-y-1" data-testid="dev-servers-projects">
        {projects.slice(0, LISTED).map((project) => (
          <li key={project.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="min-w-0 truncate font-medium text-foreground">{project.name}</span>
            <Link
              to="/projects/$projectId/pm"
              params={{ projectId: project.id }}
              className={link}
              aria-label={`PM page of ${project.name}`}
            >
              PM page
            </Link>
            <a
              href={devPreviewSettingsHref(project.id)}
              className={link}
              aria-label={`Dev preview settings of ${project.name}`}
            >
              Dev preview settings
            </a>
          </li>
        ))}
      </ul>
      {projects.length > LISTED && (
        <p className="mt-1.5">
          And {projects.length - LISTED} more: open one from the sidebar, then its PM page or its
          Settings.
        </p>
      )}
    </>
  );
}

/**
 * What the page shows while nothing is listed: how a dev server gets here, since this page
 * can't start one. The written steps stand without the two example pictures.
 */
export function DevServersHowTo({ remote, projects }: { remote: boolean; projects: Project[] }) {
  return (
    <section
      aria-labelledby="dev-servers-empty-title"
      className="mx-auto w-full max-w-3xl space-y-4 text-xs leading-relaxed text-muted-foreground"
      data-testid="dev-servers-empty"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card shadow-xs [&_svg]:size-[18px]">
          <MonitorPlay />
        </span>
        <div>
          <h2 id="dev-servers-empty-title" className="text-sm font-medium text-foreground">
            No dev servers are running
          </h2>
          <p>
            This page lists every dev preview and stops them. It can't start one: a preview is
            switched on where it belongs.
          </p>
        </div>
      </div>
      {remote && (
        <p
          className="rounded-lg border border-border bg-muted/40 px-3 py-2"
          data-testid="dev-servers-remote"
        >
          {DEV_SERVERS_REMOTE} From this device you can watch them here and stop them.
        </p>
      )}
      <ol className="list-decimal space-y-3 pl-5 marker:font-medium marker:text-foreground">
        <li>
          Open a project's <b className="text-foreground">PM page</b>, or a{" "}
          <b className="text-foreground">session</b>, and turn on the{" "}
          <b className="text-foreground">Dev preview</b> switch at the top.
          <DevPreviewSwitchExample />
        </li>
        <li>
          The first time for a project, the app shows the commands it will run and asks{" "}
          <b className="text-foreground">Run these commands on this computer?</b>{" "}
          <b className="text-foreground">Save and allow</b> stores them and starts the preview. If
          the app has nothing to suggest for the project, the switch opens the project's settings
          instead, where you type the dev command.
        </li>
        <li>
          The preview then shows up on this page, with its status and its link, and you can stop it
          here.
        </li>
      </ol>
      <div>
        <h3 className="text-xs font-medium text-foreground">What a project needs first</h3>
        <p data-testid="dev-servers-needs">
          Its dev preview settings: the <b className="text-foreground">dev command</b>, and a{" "}
          <b className="text-foreground">prepare command</b> when the project has dependencies to
          install. They are set on the project's page › <b className="text-foreground">Settings</b>{" "}
          › <b className="text-foreground">Dev preview</b>
          {remote ? ", on the computer running the app." : "."}
        </p>
        <DevPreviewSettingsExample />
        <ProjectLinks projects={projects} />
      </div>
    </section>
  );
}
