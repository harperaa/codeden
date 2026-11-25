import type { DevPreviewState } from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useClient } from "@/lib/api";

export const devPreviewKey = ["dev-preview"] as const;
/** The list of every project's previews (the Dev Servers page and its sidebar entry). */
export const devServersKey = [...devPreviewKey, "servers"] as const;
const stateKey = (target: PreviewTarget) =>
  target.sessionId
    ? ([...devPreviewKey, "session", target.sessionId] as const)
    : ([...devPreviewKey, "base", target.projectId] as const);

/** A session's own preview, or (without a session) the project's base-branch preview. */
export interface PreviewTarget {
  projectId: string;
  sessionId: string | null;
}

/** How often the bar asks again: often while something is coming up, rarely when nothing can. */
function pollEvery(state: DevPreviewState | undefined): number {
  if (!state) return 5_000;
  if (!state.configured) return 30_000;
  if (state.status === "preparing" || state.status === "starting") return 1_500;
  return 5_000;
}

/**
 * A preview's state and the actions on it. The state is asked for again every few seconds
 * while the thread is open; nothing about a preview travels on the app's live event stream.
 */
export function useDevPreview(target: PreviewTarget) {
  const client = useClient();
  const queryClient = useQueryClient();
  const key = stateKey(target);
  const { sessionId, projectId } = target;
  const state = useQuery({
    queryKey: key,
    queryFn: () =>
      sessionId ? client.devPreview.session(sessionId) : client.devPreview.base(projectId),
    refetchInterval: (query) => pollEvery(query.state.data),
    retry: false,
  });
  const done = (next: DevPreviewState) => {
    queryClient.setQueryData(key, next);
    // The Dev Servers page lists it: it hears of the change at once, not at its next look.
    void queryClient.invalidateQueries({ queryKey: devServersKey });
  };
  const failed = (what: string) => (error: Error) => {
    toast.error(what, { description: error.message });
    void queryClient.invalidateQueries({ queryKey: key });
  };
  const turn = useMutation({
    mutationFn: (on: boolean) =>
      sessionId
        ? on
          ? client.devPreview.startSession(sessionId)
          : client.devPreview.stopSession(sessionId)
        : client.devPreview.setPm(projectId, on),
    onSuccess: done,
    onError: failed("Dev preview not changed"),
  });
  /** Start it again after it stopped or failed; for the base branch, look for commits first. */
  const restart = useMutation({
    mutationFn: () =>
      sessionId
        ? client.devPreview.startSession(sessionId)
        : client.devPreview.updateBase(projectId),
    onSuccess: done,
    onError: failed("Dev preview not started"),
  });
  return { state: state.data, turn, restart };
}
