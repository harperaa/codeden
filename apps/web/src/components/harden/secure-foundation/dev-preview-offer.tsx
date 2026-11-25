import { type DevPreviewSettings, hardenDocsUrl } from "@codeden/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useEffect } from "react";
import { devPreviewKey } from "@/components/harden/dev-preview/use-dev-preview";
import { useClient } from "@/lib/api";
import { secureFoundationKey } from "./use-secure-foundation";

/** The dev preview guide's section on projects Secure Foundation set up. */
export const secureFoundationDevPreviewUrl = () =>
  `${hardenDocsUrl("dev-preview.md")}#secure-foundation-projects`;

/** Where the dev preview's settings are on the project page; the card's link goes there. */
export const DEV_PREVIEW_ANCHOR = "dev-preview";

/**
 * What the dev preview's settings form is filled with for a project Secure Foundation set up,
 * as the server built it from the names of the setup form. Undefined until it is known; for any
 * other project, and on another device, `applies` is false.
 */
export function useSecureFoundationDevPreview(projectId: string) {
  return useSecureFoundationDevPreviewQuery(projectId).data;
}

/** The same as a query, for a reader that waits for the answer or only asks sometimes. */
export function useSecureFoundationDevPreviewQuery(projectId: string, enabled = true) {
  const client = useClient();
  return useQuery({
    queryKey: [...secureFoundationKey, "dev-preview", projectId],
    queryFn: () => client.secureFoundation.devPreview(projectId),
    staleTime: 60_000,
    retry: false,
    enabled,
  });
}

/** Text in which `backticks` mark a command, a name or a path. */
export function Coded({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed sentence
        i % 2 === 1 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

/**
 * On the project page's Secure Foundation card: the way to the dev preview's settings, which
 * open with their fields filled in, and that Convex runs separately. It sets nothing up itself:
 * the commands are stored by the settings form's own button and its confirmation.
 */
export function SecureFoundationDevPreviewLink({ projectId }: { projectId: string }) {
  const client = useClient();
  const offer = useSecureFoundationDevPreview(projectId);
  const view = useQuery({
    queryKey: [...devPreviewKey, "project", projectId],
    queryFn: () => client.devPreview.project(projectId),
    enabled: Boolean(offer?.applies),
  });
  if (!offer?.applies || !view.data || view.data.remote) return null;
  const configured = view.data.config !== null;
  return (
    <div className="mt-2 space-y-1 text-2xs" data-testid="secure-foundation-dev-preview">
      <p>
        <span className="font-medium">Dev preview:</span>{" "}
        <span className="text-muted-foreground">
          {configured
            ? "set up. The app runs this project's dev server where a session works, and for the PM thread."
            : "the app can run this project's dev server where each session works, and for the PM thread, so you see a session's changes as it makes them. The settings open filled in for this project; you check and confirm them."}
        </span>{" "}
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          search={{ tab: "settings" }}
          hash={DEV_PREVIEW_ANCHOR}
          className="font-medium underline underline-offset-2 hover:text-foreground"
          data-testid="secure-foundation-dev-preview-link"
        >
          {configured ? "Dev preview settings" : "Set up the dev preview"}
        </Link>
      </p>
      {offer.convex && (
        <p className="text-muted-foreground" data-testid="secure-foundation-convex">
          <Coded text={offer.convex} />
        </p>
      )}
    </div>
  );
}

/**
 * In the dev preview's settings form of a project Secure Foundation set up: what the fields are
 * filled with and why, what stays for the person to do, and a button that fills them in again.
 * Filling in only changes the form. Renders nothing for any other project.
 */
export function SecureFoundationDevPreviewNotes({
  projectId,
  filled,
  onFill,
}: {
  projectId: string;
  /** The form already holds the offered values. */
  filled: boolean;
  /** Put the offered values in the form; absent where the form is read-only. */
  onFill?: (settings: DevPreviewSettings) => void;
}) {
  const offer = useSecureFoundationDevPreview(projectId);
  const applies = Boolean(offer?.applies);
  // The card's link names this section; it renders after the page did, so scroll to it here.
  useEffect(() => {
    if (!applies || window.location.hash !== `#${DEV_PREVIEW_ANCHOR}`) return;
    document.getElementById(DEV_PREVIEW_ANCHOR)?.scrollIntoView?.({ block: "start" });
  }, [applies]);
  if (!offer?.applies) return null;
  const { settings } = offer;
  return (
    <div
      className="space-y-1.5 px-4 py-3.5 text-2xs"
      data-testid="secure-foundation-dev-preview-notes"
    >
      <p>
        <span className="font-medium">A Secure Foundation project.</span>{" "}
        <span className="text-muted-foreground">
          {settings
            ? filled
              ? "The fields below are filled in with the values that work for it. Nothing is stored or run until you confirm them."
              : "The fields below can be filled in with the values that work for it. Nothing is stored or run until you confirm them."
            : "Nothing could be filled in for it:"}
        </span>{" "}
        {settings && !filled && onFill && (
          <button
            type="button"
            className="font-medium underline underline-offset-2 hover:text-foreground"
            onClick={() => onFill(settings)}
            data-testid="secure-foundation-dev-preview-fill"
          >
            Fill them in
          </button>
        )}
      </p>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
        {offer.notes.map((note) => (
          <li key={note}>
            <Coded text={note} />
          </li>
        ))}
        {offer.convex && (
          <li>
            <Coded text={offer.convex} />
          </li>
        )}
      </ul>
      <a
        href={secureFoundationDevPreviewUrl()}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground underline underline-offset-2"
      >
        Dev previews of a Secure Foundation project
      </a>
    </div>
  );
}
