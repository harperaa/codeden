import {
  SECURE_FOUNDATION_OPT_IN_MODE,
  SECURE_FOUNDATION_PROJECT_MODE,
  SECURE_FOUNDATION_WORK_KEY,
} from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { holdsPmWakes } from "../src/services/secure-foundation/quiet";
import { createOrchestrationEnv, type OrchestrationEnv } from "./support/orchestration-env";

/**
 * A project Secure Foundation set up starts quiet: what GitHub reports about it is kept, but
 * starts no project manager (and so no agent session) until the person changes the project's
 * autonomy mode. Over a real database and event log with a fake GitHub and a scripted session
 * service: every session start and every message is recorded, none reaches a provider.
 */
let env: OrchestrationEnv;
/** The fake GitHub's project (`createGithubEnv`). */
const P = "p-gh";

beforeEach(() => {
  env = createOrchestrationEnv();
});
afterEach(() => env.close());

/** Make the project one Secure Foundation set up: its setup session, and the mode it starts in. */
function secureFoundationProject(): void {
  env.github.addSession({
    workKey: SECURE_FOUNDATION_WORK_KEY,
    purpose: "Secure Foundation setup",
    title: "Secure Foundation setup",
    branch: "main",
    worktreePath: null,
    autonomy: "full",
  });
  env.updateProject(P, { autonomyMode: SECURE_FOUNDATION_PROJECT_MODE });
}

/** A pull request no session of this project opened appears on GitHub, and is read. */
async function pullRequestFromOutside(head: string): Promise<number> {
  const { number } = env.github.gh.addPr(head, { title: `Bump ${head}` });
  await env.syncAndSettle(P);
  return number;
}

const pmStarts = () => env.starts.filter((s) => s.role === "pm");
const wakes = () => env.messages.filter((m) => m.from === "codeden");
/** The pull requests and issues still waiting for the project manager, by title. */
const waiting = () => env.orchestration.notices.undelivered("pm", P).map((n) => n.title);
const deps = () => ({ db: env.github.db.db, projects: env.projects });

describe("a quiet Secure Foundation project", () => {
  it("starts no project manager and no agent session for a pull request from outside", async () => {
    secureFoundationProject();
    await env.syncAndSettle(P); // the first import, which is silent in every project
    const pr = await pullRequestFromOutside("deps/left-pad-2.0.0");
    const issue = env.github.gh.addIssue({ title: "Crash on save" }).number;
    await env.syncAndSettle(P);

    // Both were read and are kept for the project manager's next turn...
    expect(waiting()).toEqual([
      `PR #${pr} opened: Bump deps/left-pad-2.0.0`,
      `Issue #${issue} opened: Crash on save`,
    ]);
    // ...and nothing was started or sent: no project manager, no agent session, no wake.
    expect(env.starts).toEqual([]);
    expect(env.messages).toEqual([]);
    expect(env.orchestration.roles.find("pm", P)).toBeUndefined();
  });

  it("hands what it kept to the project manager when the person writes to it", async () => {
    secureFoundationProject();
    await env.syncAndSettle(P);
    const pr = await pullRequestFromOutside("deps/left-pad-2.0.0");
    expect(env.starts).toEqual([]);

    // The person's own message starts the project manager, as in every project...
    const sent = await env.orchestration.sendToRole("pm", P, { text: "hello", attachments: [] });
    expect(sent.status).toBe("sent");
    expect(pmStarts()).toHaveLength(1);
    expect(env.messages).toHaveLength(1);
    const turn = env.messages[0];
    expect(turn).toMatchObject({ sessionId: sent.sessionId, from: "user" });
    // ...and that turn carries the kept pull request with the message: nothing was lost.
    expect(turn?.text).toContain(`PR #${pr} opened: Bump deps/left-pad-2.0.0`);
    expect(turn?.text.endsWith("hello")).toBe(true);
    expect(waiting()).toEqual([]);

    // The project manager exists now, and is still not woken by what GitHub reports.
    const next = await pullRequestFromOutside("deps/right-pad-3.0.0");
    expect(wakes()).toEqual([]);
    expect(waiting()).toEqual([`PR #${next} opened: Bump deps/right-pad-3.0.0`]);
  });

  it("wakes its project manager once the person turns automatic work on, with what it kept", async () => {
    secureFoundationProject();
    await env.syncAndSettle(P);
    const kept = await pullRequestFromOutside("deps/left-pad-2.0.0");
    expect(env.starts).toEqual([]);

    env.updateProject(P, { autonomyMode: SECURE_FOUNDATION_OPT_IN_MODE });
    const fresh = await pullRequestFromOutside("deps/right-pad-3.0.0");
    expect(pmStarts()).toHaveLength(1);
    expect(pmStarts()[0]).toMatchObject({ projectId: P, role: "pm" });
    const pm = env.orchestration.roles.find("pm", P);
    expect(wakes()).toHaveLength(1);
    expect(wakes()[0]?.sessionId).toBe(pm?.id);
    // One wake carries the new pull request and the one that arrived while the project was quiet.
    expect(wakes()[0]?.text).toContain(`PR #${kept} opened: Bump deps/left-pad-2.0.0`);
    expect(wakes()[0]?.text).toContain(`PR #${fresh} opened: Bump deps/right-pad-3.0.0`);
    expect(waiting()).toEqual([]);

    // Back in the mode it was created in, the project is quiet again.
    env.updateProject(P, { autonomyMode: SECURE_FOUNDATION_PROJECT_MODE });
    const later = await pullRequestFromOutside("deps/center-pad-1.0.0");
    expect(wakes()).toHaveLength(1);
    expect(pmStarts()).toHaveLength(1);
    expect(waiting()).toEqual([`PR #${later} opened: Bump deps/center-pad-1.0.0`]);
  });
});

describe("which projects are quiet", () => {
  it("only one Secure Foundation set up, while it is in the mode it was created in", () => {
    // A project in Manual mode that Secure Foundation didn't set up is not held back.
    env.updateProject(P, { autonomyMode: SECURE_FOUNDATION_PROJECT_MODE });
    expect(holdsPmWakes(deps(), P)).toBe(false);

    const setup = env.github.addSession({ workKey: SECURE_FOUNDATION_WORK_KEY });
    expect(holdsPmWakes(deps(), P)).toBe(true);
    // The setup session is the mark for good: archiving it changes nothing.
    env.github.repo.update(setup.id, (s) => ({ ...s, archivedAt: new Date().toISOString() }));
    expect(holdsPmWakes(deps(), P)).toBe(true);

    env.updateProject(P, { autonomyMode: SECURE_FOUNDATION_OPT_IN_MODE });
    expect(holdsPmWakes(deps(), P)).toBe(false);
  });

  it("never the orchestrator, another project or a project that is gone", () => {
    env.github.addSession({ workKey: SECURE_FOUNDATION_WORK_KEY });
    env.updateProject(P, { autonomyMode: SECURE_FOUNDATION_PROJECT_MODE });
    env.updateProject("p-local", { autonomyMode: SECURE_FOUNDATION_PROJECT_MODE });
    expect(holdsPmWakes(deps(), null)).toBe(false);
    expect(holdsPmWakes(deps(), "p-local")).toBe(false);
    expect(holdsPmWakes(deps(), "p-gone")).toBe(false);
  });

  // Projects Secure Foundation didn't set up behave as they did, in either mode.
  it.each(["assisted", "manual"] as const)(
    "leaves another project in %s mode as it was: its project manager is woken",
    async (autonomyMode) => {
      env.updateProject(P, { autonomyMode });
      // A session of its own, which is no setup session.
      env.github.addSession({ workKey: "request:hello" });
      await env.syncAndSettle(P);
      const pr = await pullRequestFromOutside("deps/left-pad-2.0.0");
      expect(pmStarts()).toHaveLength(1);
      expect(pmStarts()[0]).toMatchObject({ projectId: P, role: "pm", autonomy: "auto" });
      expect(wakes()).toHaveLength(1);
      expect(wakes()[0]?.text).toContain(`PR #${pr} opened: Bump deps/left-pad-2.0.0`);
      expect(waiting()).toEqual([]);
    },
  );
});
