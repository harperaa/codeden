import {
  type AgentEvent,
  agentEventToNewEvent,
  type ErrorInfo,
  type FactoryItem,
  type Session,
} from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROVIDER_FAILURE_BACKOFF_MS } from "../src/services/factory/availability";
import {
  MAX_PROVIDER_RESTARTS,
  providerFailure,
  providerRestarts,
  providerWide,
  skipProvider,
  skippedProviders,
} from "../src/services/factory/provider-failure";
import { FACTORY_STARTER } from "../src/services/factory/sessions";
import { setUnanswered } from "../src/services/sessions/unanswered-start";
import { createFactoryEnv, type FactoryEnv } from "./support/factory-env";
import { APPROVE, factorySteps } from "./support/factory-steps";

/**
 * Whether a failed factory session failed because of its provider (usage limit, sign-in, a CLI
 * too old, a start that never happened) or because of its work, and which providers an item's
 * reviews skip. The rules themselves, over a real session repository; the loop's use of them is
 * in `factory-stalls.test.ts` and `factory-reviewer-replaced.test.ts`.
 */

let env: FactoryEnv;
beforeEach(() => {
  env = createFactoryEnv();
});
afterEach(() => env.close());
const { item, backlogItem, enable, verifying, tick, review } = factorySteps(() => env);

const FAILING_TO_START = { reason: "failing to start", until: null };
const NOT_SIGNED_IN = { reason: "not signed in", until: null, signin: true };

/** A factory session, as the launcher leaves it: running, no turn yet. */
async function session(): Promise<string> {
  const res = await env.sessions.start({
    projectId: env.project.id,
    role: "agent",
    startedBy: FACTORY_STARTER,
    workKey: "issue:3",
  } as Parameters<FactoryEnv["sessions"]["start"]>[0]);
  if (res.status !== "started") throw new Error("not started");
  return res.sessionId;
}

const set = (id: string, patch: Partial<Session>) =>
  env.repo.update(id, (s) => ({ ...s, ...patch }));
const cause = (id: string) => providerFailure(env.repo, env.inbox, env.repo.get(id));

/** The session runs a turn that fails with `error` (or ends well, without one). */
function turn(id: string, turnId: string, error?: ErrorInfo): void {
  const before = env.repo.get(id);
  const threadId = before.rootThreadId ?? `t-${id}`;
  const events = [
    ...(before.rootThreadId ? [] : [{ type: "thread.started", thread: { id: threadId } }]),
    { type: "turn.started", threadId, turnId },
    error
      ? { type: "turn.failed", threadId, turnId, error }
      : { type: "turn.completed", threadId, turnId },
  ] as AgentEvent[];
  env.store.append(events.map((e) => agentEventToNewEvent(id, e)));
}

describe("providerFailure", () => {
  it("is null for a session that is at work, finished or stopped", async () => {
    const id = await session();
    for (const status of ["running", "waiting", "completed", "stopped", "interrupted"] as const) {
      set(id, { status, startError: { message: "Not signed in", kind: "auth" } });
      expect(cause(id)).toBeNull();
    }
    // Idle before any turn: nothing failed.
    set(id, { status: "idle", startError: null });
    expect(cause(id)).toBeNull();
  });

  it("names a CLI too old to run and a provider that is not signed in, from the refused open", async () => {
    const id = await session();
    set(id, { status: "failed", startError: { message: "Update the CLI", kind: "setup" } });
    expect(cause(id)).toEqual({ reason: "too old to run (update it)", until: null });
    set(id, { status: "failed", startError: { message: "Not signed in", kind: "auth" } });
    expect(cause(id)).toEqual(NOT_SIGNED_IN);
  });

  it("counts a refused open nobody classified as failing to start", async () => {
    const id = await session();
    set(id, { status: "failed", startError: { code: "open_failed", message: "spawn ENOENT" } });
    expect(cause(id)).toEqual(FAILING_TO_START);
    // Another classification says nothing about the provider's sign-in or version either.
    set(id, { status: "failed", startError: { message: "Usage limit", kind: "usage_limit" } });
    expect(cause(id)).toEqual(FAILING_TO_START);
  });

  it("is null for a start the runner left unanswered", async () => {
    const id = await session();
    set(id, { status: "failed" });
    setUnanswered(env.repo, id, { code: "timeout", at: env.now().toISOString() });
    expect(cause(id)).toBeNull();
    // Even with the launcher's inbox item: the runner may still have started it.
    env.inbox.raiseRunFailed(env.repo.get(id), "start", "The runner did not answer");
    expect(cause(id)).toBeNull();
    // Once the runner answered a later start, the failure counts.
    setUnanswered(env.repo, id, null);
    expect(cause(id)).toEqual(FAILING_TO_START);
  });

  it("counts a run_failed inbox item keyed start as failing to start, and no other key", async () => {
    const id = await session();
    set(id, { status: "failed" });
    // Failed with nothing recorded about its start: not the provider's failure.
    expect(cause(id)).toBeNull();

    const other = await session();
    set(other, { status: "failed" });
    env.inbox.raiseRunFailed(env.repo.get(other), "crash", "The process exited");
    expect(cause(other)).toBeNull();

    env.inbox.raiseRunFailed(env.repo.get(id), "start", "Could not start");
    expect(cause(id)).toEqual(FAILING_TO_START);
    expect(cause(other)).toBeNull();
  });

  it("carries the time a usage limit resets, or null when the provider gave none", async () => {
    const retryAt = new Date(env.now().getTime() + 3 * 3_600_000).toISOString();
    const id = await session();
    turn(id, "u1", { message: "Usage limit", kind: "usage_limit", retryAt });
    // Waiting idle to retry, or failed outright: the same cause.
    for (const status of ["idle", "failed"] as const) {
      set(id, { status });
      expect(cause(id)).toEqual({ reason: "at its usage limit", until: retryAt });
    }

    const unknown = await session();
    turn(unknown, "u1", { message: "Usage limit", kind: "usage_limit" });
    set(unknown, { status: "idle" });
    expect(cause(unknown)).toEqual({ reason: "at its usage limit", until: null });
  });

  it("names a sign-in problem from a failed turn", async () => {
    const id = await session();
    turn(id, "u1", { message: "Please log in", kind: "auth" });
    set(id, { status: "failed" });
    expect(cause(id)).toEqual(NOT_SIGNED_IN);
  });

  it("is null for a turn that failed for another reason, and reads only the last turn", async () => {
    const id = await session();
    turn(id, "u1", { message: "Usage limit", kind: "usage_limit" });
    turn(id, "u2", { message: "The model crashed", code: "provider_crashed" });
    set(id, { status: "failed" });
    expect(cause(id)).toBeNull();
    // A start error from before its turns no longer says anything.
    set(id, { status: "failed", startError: { message: "Not signed in", kind: "auth" } });
    expect(cause(id)).toBeNull();

    const worked = await session();
    turn(worked, "u1", { message: "Usage limit", kind: "usage_limit" });
    turn(worked, "u2");
    set(worked, { status: "idle" });
    expect(cause(worked)).toBeNull();

    turn(worked, "u3", { message: "Please log in", kind: "auth" });
    set(worked, { status: "idle" });
    expect(cause(worked)).toEqual(NOT_SIGNED_IN);
  });
});

describe("providerWide", () => {
  it("is false only for a start that failed for an unclassified reason", () => {
    expect(providerWide(FAILING_TO_START)).toBe(false);
    for (const wide of [
      NOT_SIGNED_IN,
      { reason: "too old to run (update it)", until: null },
      { reason: "at its usage limit", until: null },
      { reason: "at its usage limit", until: "2026-01-05T12:00:00.000Z" },
    ]) {
      expect(providerWide(wide)).toBe(true);
    }
  });
});

describe("an item's provider restarts and skipped providers", () => {
  const NOW = new Date("2026-01-05T10:00:00.000Z");
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
  const withNudges = (nudges: FactoryItem["nudges"]) => ({ nudges }) as FactoryItem;
  const BACKOFF_MIN = PROVIDER_FAILURE_BACKOFF_MS / 60_000;

  it("counts each provider failure of the item, up to the limit the reviewer stops at", () => {
    let nudges: FactoryItem["nudges"] = { reviewer: NOW.toISOString() };
    expect(providerRestarts(withNudges(nudges))).toBe(0);
    for (let n = 1; n <= MAX_PROVIDER_RESTARTS; n++) {
      expect(providerRestarts(withNudges(nudges))).toBeLessThan(MAX_PROVIDER_RESTARTS);
      nudges = skipProvider(nudges, n % 2 ? "claude" : "codex", null, at(n));
      expect(providerRestarts(withNudges(nudges))).toBe(n);
    }
    expect(providerRestarts(withNudges(nudges))).toBe(MAX_PROVIDER_RESTARTS);
    // Nothing else of the item was touched, and another item counts for itself.
    expect(nudges.reviewer).toBe(NOW.toISOString());
    expect(providerRestarts(withNudges({}))).toBe(0);
  });

  it("counts the failures in a row from the first: a gap ends the count", () => {
    const stamp = NOW.toISOString();
    expect(
      providerRestarts(
        withNudges({ reviewer_provider_failed_1: stamp, reviewer_provider_failed_3: stamp }),
      ),
    ).toBe(1);
    expect(providerRestarts(withNudges({ reviewer_provider_failed_2: stamp }))).toBe(0);
    // The reviewer's own restarts are a different count.
    expect(providerRestarts(withNudges({ reviewer_failed_1: stamp }))).toBe(0);
  });

  // Pins current behaviour. Issue #57 suggested "it starts again after a turn that worked"; that
  // was a guess, corrected in a comment on #57: nothing resets the count but a retry of the item.
  it("pins current behaviour: a reviewer's turn that worked does not reset the count, it is per item", async () => {
    await enable();
    const { id } = await verifying("pending");
    const first = item(id).reviewerSessionId as string;
    const firstProvider = env.repo.get(first).provider;
    turn(first, "u1", { message: "Usage limit", kind: "usage_limit" });
    set(first, { status: "idle" });
    await tick();
    expect(providerRestarts(item(id))).toBe(1);
    expect(skippedProviders(item(id), env.now()).map((s) => s.provider)).toEqual([firstProvider]);

    // A fresh reviewer on another provider runs a turn that works and gives its verdict.
    await tick();
    const second = item(id).reviewerSessionId as string;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(env.repo.get(second).provider).not.toBe(firstProvider);
    turn(second, "u1");
    review(id, { ...APPROVE, verdict: "request_changes", summary: "Missing a test" });
    expect(item(id).review?.verdict).toBe("request_changes");
    // The earlier failure still counts, and its provider stays skipped until its time.
    expect(providerRestarts(item(id))).toBe(1);
    expect(skippedProviders(item(id), env.now()).map((s) => s.provider)).toEqual([firstProvider]);

    // The revise round that follows keeps it too: the item's next provider failure is its second.
    await env.setStatus(second, "idle");
    await tick();
    expect(providerRestarts(item(id))).toBe(1);
    const nudges = skipProvider(item(id).nudges, env.repo.get(second).provider, null, env.now());
    expect(providerRestarts({ nudges } as FactoryItem)).toBe(2);
  });

  it("starts the count again when the item is retried", () => {
    const created = backlogItem();
    env.factory.data.updateItem(created.id, (i) => ({
      ...i,
      stage: "failed",
      reason: "The reviewer session failed",
      failureKind: "infrastructure",
      finishedAt: env.now().toISOString(),
      nudges: skipProvider(skipProvider(i.nudges, "claude", null, at(0)), "codex", null, at(1)),
    }));
    expect(providerRestarts(item(created.id))).toBe(2);
    env.factory.retry(env.project.id, created.id);
    expect(providerRestarts(item(created.id))).toBe(0);
    expect(skippedProviders(item(created.id), at(2))).toEqual([]);
  });

  it("skips the provider until the time it gave, when that is still ahead", () => {
    const until = at(180).toISOString();
    const nudges = skipProvider({}, "claude", until, NOW);
    expect(nudges).toEqual({
      reviewer_skip_claude: until,
      reviewer_provider_failed_1: NOW.toISOString(),
    });
  });

  it("skips the provider for a while when it gave no time, or one already past", () => {
    const fallback = at(BACKOFF_MIN).toISOString();
    for (const until of [null, at(-1).toISOString(), NOW.toISOString(), "not a date"]) {
      expect(skipProvider({}, "codex", until, NOW).reviewer_skip_codex).toBe(fallback);
    }
  });

  it("keeps a skip until its time and drops it after", () => {
    const until = at(90).toISOString();
    let nudges = skipProvider({ reviewer: NOW.toISOString() }, "claude", until, NOW);
    nudges = skipProvider(nudges, "codex", null, NOW);
    const skipped = (now: Date) => skippedProviders(withNudges(nudges), now);

    expect(skipped(NOW)).toEqual([
      { provider: "claude", reason: "failing to run reviews", until },
      {
        provider: "codex",
        reason: "failing to run reviews",
        until: at(BACKOFF_MIN).toISOString(),
      },
    ]);
    // Codex's while is over first; Claude stays skipped up to its own time, not at it.
    expect(skipped(at(BACKOFF_MIN)).map((s) => s.provider)).toEqual(["claude"]);
    expect(skipped(at(89)).map((s) => s.provider)).toEqual(["claude"]);
    expect(skipped(at(90))).toEqual([]);
    expect(skipped(at(600))).toEqual([]);
  });

  it("moves a provider's skip when it fails again", () => {
    const first = skipProvider({}, "claude", at(60).toISOString(), NOW);
    const again = skipProvider(first, "claude", at(240).toISOString(), at(70));
    expect(skippedProviders(withNudges(again), at(70))).toEqual([
      { provider: "claude", reason: "failing to run reviews", until: at(240).toISOString() },
    ]);
    expect(providerRestarts(withNudges(again))).toBe(2);
  });
});
