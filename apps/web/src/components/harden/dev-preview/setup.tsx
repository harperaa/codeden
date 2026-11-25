import {
  type DevPreviewProject,
  DevPreviewSettings,
  type DevPreviewState,
  type SecureFoundationDevPreview,
} from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  DEV_PREVIEW_ANCHOR,
  SecureFoundationDevPreviewTodo,
  useSecureFoundationDevPreviewQuery,
} from "@/components/harden/secure-foundation/dev-preview-offer";
import { useClient } from "@/lib/api";
import { DevPreviewConfirmDialog } from "./confirm-dialog";
import { devPreviewKey, type PreviewTarget } from "./use-dev-preview";

/** The project's dev preview settings, as a plain address. */
export const devPreviewSettingsHref = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}?tab=settings#${DEV_PREVIEW_ANCHOR}`;

/** Settings the app can offer for a project that has none stored, and why these. */
export interface DevPreviewOffer {
  settings: DevPreviewSettings;
  /** Where they come from, as the dialog says it: "A CodeHarden checkout". */
  reason: string;
  /**
   * For a Secure Foundation project: the answer the settings come from, whose notes say what
   * stays for the person to do. The dialog shows them as the settings form does.
   */
  secureFoundation?: SecureFoundationDevPreview;
}

/**
 * What the switch offers to confirm for a project with nothing stored: the same values the
 * settings form would start from or offer to fill in, from the same three sources and in the
 * same order. Null when there are none; then the person types a command in the settings.
 *
 * Every value is one the app wrote (its constants, or what the person answered in the Secure
 * Foundation form). Nothing here is text from the repository, and nothing is stored by it.
 *
 * Both answers are needed. Without the Secure Foundation one (not there yet, or the lookup
 * failed) nothing is offered: the plain dev command is only right for a project that answer
 * says is not a Secure Foundation project.
 */
export function devPreviewOffer(
  view: DevPreviewProject | undefined,
  secureFoundation: SecureFoundationDevPreview | undefined,
): DevPreviewOffer | null {
  if (!view || !secureFoundation || view.remote || view.config) return null;
  if (secureFoundation.applies) {
    // Without values for such a project a plain dev command would not be enough either.
    return secureFoundation.settings
      ? {
          settings: secureFoundation.settings,
          reason: "A Secure Foundation project",
          secureFoundation,
        }
      : null;
  }
  if (view.recommended) return view.recommended;
  if (!view.suggestion) return null;
  const settings = DevPreviewSettings.safeParse({
    command: view.suggestion.command,
    // The install command for the same lockfile; null when the folder has none.
    prepareCommand: view.suggestion.prepareCommand,
  });
  return settings.success ? { settings: settings.data, reason: view.suggestion.reason } : null;
}

/**
 * Switching a preview on in a project that has no dev preview settings yet.
 *
 * With an offer, `begin` opens the confirmation the settings form uses, with the offered
 * commands; "Save and allow" stores them and starts this thread's preview, "Cancel" stores
 * nothing. Without one it opens the project's settings, where a command is typed. Nothing is
 * stored or started from here except through that dialog.
 */
export function useDevPreviewSetup(target: PreviewTarget, state: DevPreviewState | undefined) {
  const client = useClient();
  const queryClient = useQueryClient();
  // The strip also renders where there is no router around it.
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | undefined;
  const { projectId, sessionId } = target;
  // Only where the switch could start something: not set up, on this computer, not disabled.
  const wanted = Boolean(state && !state.configured && !state.remote && !state.unavailable);
  const view = useQuery({
    queryKey: [...devPreviewKey, "project", projectId],
    queryFn: () => client.devPreview.project(projectId),
    enabled: wanted,
    staleTime: 30_000,
    retry: false,
  });
  const secureFoundation = useSecureFoundationDevPreviewQuery(projectId, wanted);
  const [asking, setAsking] = useState<DevPreviewSettings | null>(null);
  // Kept beside it: the offer is gone the moment the settings are stored, the dialog a bit later.
  const [shown, setShown] = useState<DevPreviewOffer | null>(null);
  const loading = wanted && (view.isPending || secureFoundation.isPending);
  // A lookup that failed says nothing about the project. Then nothing is offered, whatever the
  // other one answered: the strip says so, and the next switch asks again.
  const failed = wanted && !loading && (view.isError || secureFoundation.isError);
  const offer =
    wanted && !loading && !failed ? devPreviewOffer(view.data, secureFoundation.data) : null;
  const href = devPreviewSettingsHref(projectId);
  const openSettings = () => {
    setAsking(null);
    if (router) router.history.push(href);
    else window.location.assign(href);
  };

  const save = useMutation({
    /** Resolves with why the preview didn't start after the settings were stored, or null. */
    mutationFn: async (settings: DevPreviewSettings): Promise<string | null> => {
      await client.devPreview.confirmProject(projectId, settings);
      // The PM thread's preview starts with settings that have it switched on.
      if (!sessionId) return null;
      try {
        await client.devPreview.startSession(sessionId);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    onSuccess: (notStarted) => {
      setAsking(null);
      void queryClient.invalidateQueries({ queryKey: devPreviewKey });
      if (notStarted)
        toast.error("Dev preview saved, but not started", { description: notStarted });
      else toast.success("Dev preview saved");
    },
    onError: (e) => toast.error("Dev preview not saved", { description: e.message }),
  });

  return {
    /** The offer isn't known yet: the switch waits for it. */
    loading,
    /** What the project could be offered couldn't be looked up; the settings are still there. */
    failed,
    /** Nothing can be offered: a dev command has to be typed in the settings first. */
    needsCommand: wanted && !loading && !failed && !offer,
    /** The person switched it on. */
    begin: async () => {
      let found = offer;
      if (failed) {
        // Ask again. Still no answer: nothing is offered and the strip keeps saying so.
        const [project, foundation] = await Promise.all([
          view.refetch(),
          secureFoundation.refetch(),
        ]);
        if (project.isError || foundation.isError) return;
        found = devPreviewOffer(project.data, foundation.data);
      }
      if (!found) return openSettings();
      setShown(found);
      // The switch is this thread's: the PM thread's preview is on only when it was that one.
      setAsking({ ...found.settings, pmEnabled: sessionId === null });
    },
    dialog: (
      <DevPreviewConfirmDialog
        asking={asking}
        baseBranch={view.data?.baseBranch ?? null}
        saving={save.isPending}
        onConfirm={(settings) => save.mutate(settings)}
        onCancel={() => setAsking(null)}
      >
        {shown?.secureFoundation && (
          // What stays for the person to do (`.env.local`, Convex), as the settings form shows
          // it. It scrolls here, so the commands and the buttons stay in view.
          <div
            className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border/70 px-3 py-2 text-2xs scroll-thin"
            data-testid="dev-preview-confirm-notes"
          >
            <p className="font-medium">Before the preview works for this project:</p>
            <SecureFoundationDevPreviewTodo offer={shown.secureFoundation} />
          </div>
        )}
        <p className="text-2xs text-muted-foreground" data-testid="dev-preview-confirm-offer">
          These are the app's suggested settings for this project ({shown?.reason}).{" "}
          {sessionId
            ? "This session's preview starts once you allow them."
            : "The PM thread's preview starts once you allow them."}{" "}
          {asking && !asking.prepareCommand && (
            <>
              There is no prepare command: a fresh worktree has no installed dependencies, so most
              projects need one.{" "}
            </>
          )}
          <a
            href={href}
            className="font-medium underline underline-offset-2 hover:text-foreground"
            data-testid="dev-preview-confirm-edit"
            onClick={(event) => {
              event.preventDefault();
              openSettings();
            }}
          >
            Edit settings
          </a>
        </p>
      </DevPreviewConfirmDialog>
    ),
  };
}
