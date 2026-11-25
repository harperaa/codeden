import type { DevPreviewLimits, Session } from "@codeden/contracts";
import { conflict } from "../errors";
import { sessionIsBusy } from "./eligibility";
import type { Preview } from "./preview";

/**
 * Make room for `preview` under the limits: so many previews at once in a project, so many in
 * all. With `evict` (a person started it) the oldest idle preview is stopped, with a notice on
 * it, until there is room: a session's whose agent isn't working first, a PM thread's last.
 * Without it (the app starts one by itself) nobody's preview is stopped, and the start is
 * refused instead. A preview whose session is working is never stopped for this.
 */
export async function makeRoom(opts: {
  previews: readonly Preview[];
  preview: Preview;
  limits: DevPreviewLimits;
  evict: boolean;
  session: (id: string) => Session | undefined;
}): Promise<void> {
  const { preview, limits, evict } = opts;
  for (;;) {
    const others = opts.previews.filter((p) => p !== preview && p.active);
    const mine = others.filter((p) => p.target.projectId === preview.target.projectId);
    const [scope, limit] =
      mine.length >= limits.perProject
        ? [mine, `${limits.perProject} previews at once in a project`]
        : others.length >= limits.total
          ? [others, `${limits.total} previews at once`]
          : [null, ""];
    if (!scope) return;
    const idle = evict
      ? scope
          .filter(
            (p) =>
              !sessionIsBusy(p.target.sessionId ? opts.session(p.target.sessionId) : undefined),
          )
          .sort(
            (a, b) =>
              Number(a.target.kind === "base") - Number(b.target.kind === "base") ||
              (a.startedAt ?? 0) - (b.startedAt ?? 0),
          )[0]
      : undefined;
    if (!idle) {
      throw conflict(
        evict
          ? `The limit of ${limit} is reached, and every running preview belongs to a session that is working. Stop one first.`
          : `Not started: the limit of ${limit} is reached.`,
        "limit_reached",
      );
    }
    await idle.stop("stopped", `Stopped to make room for another preview (the limit is ${limit}).`);
  }
}
