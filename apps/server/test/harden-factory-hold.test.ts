import { FACTORY_HOLD_LABEL } from "@codeden/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerToolContext } from "../src/mcp/define";
import { triageIssue } from "../src/mcp/tools/pm/github";
import type { AppServices } from "../src/services/container";
import { createFactoryEnv, type FactoryEnv } from "./support/factory-env";
import { factorySteps } from "./support/factory-steps";

/** A hold a person placed is theirs to release: the PM's tool takes off only its own. */
let env: FactoryEnv;
afterEach(() => env?.close());
const s = factorySteps(() => env);
const projectId = () => env.project.id;
const labels = (number: number) => env.gh.issue(projectId(), number)?.labels ?? [];
const openIssue = (title: string, held = false) =>
  env.gh.openIssue({
    projectId: projectId(),
    title,
    author: "codeden",
    labels: held ? [FACTORY_HOLD_LABEL] : [],
  });
const byIssue = (number: number) =>
  env.factory.data.items(projectId()).find((i) => i.issue?.number === number);

describe("releasing held issues: whose hold it is", () => {
  it("leaves a label a person put on the issue, and says why", async () => {
    env = createFactoryEnv();
    s.enable();
    const theirs = openIssue("Rotate the keys", true);
    const comments = env.gh.comments.length;

    const res = await env.factory.release(
      projectId(),
      { issueNumber: theirs.number, reason: "looks ready to me" },
      "pm",
    );
    expect(res).toMatchObject({ issueNumber: theirs.number, held: true });
    expect(res.message).toMatch(/held by a person, not by you/);
    expect(labels(theirs.number)).toContain(FACTORY_HOLD_LABEL);
    // Nothing is posted on the issue, and the loop still skips it.
    expect(env.gh.comments).toHaveLength(comments);
    await s.tick();
    expect(byIssue(theirs.number)).toBeUndefined();
    expect((await env.factory.status(projectId())).held).toEqual([
      expect.objectContaining({ issue: expect.objectContaining({ number: theirs.number }) }),
    ]);
  });

  it("keeps a person's hold theirs when the PM holds the same issue again", async () => {
    env = createFactoryEnv();
    s.enable();
    const labelled = openIssue("Rotate the keys", true);
    const inApp = openIssue("Change the billing plan");
    await env.factory.hold(projectId(), { issueNumber: inApp.number, reason: "my call" }, "user");
    const comments = env.gh.comments.length;

    for (const issue of [labelled, inApp]) {
      const again = await env.factory.hold(
        projectId(),
        { issueNumber: issue.number, reason: "mine now" },
        "pm",
      );
      expect(again).toMatchObject({ held: true });
      expect(again.message).toMatch(/already held by a person/);
      const res = await env.factory.release(projectId(), { issueNumber: issue.number }, "pm");
      expect(res).toMatchObject({ held: true });
      expect(labels(issue.number)).toContain(FACTORY_HOLD_LABEL);
    }
    // The person's record and reason are as they left them, and nothing was posted.
    expect(env.factory.data.loopOrNew(projectId()).holds).toEqual([
      expect.objectContaining({ issueNumber: inApp.number, by: "user", reason: "my call" }),
    ]);
    expect(env.gh.comments).toHaveLength(comments);
  });

  it("leaves a hold a person made through the app", async () => {
    env = createFactoryEnv();
    s.enable();
    const issue = openIssue("Change the billing plan");
    await env.factory.hold(projectId(), { issueNumber: issue.number, reason: "my call" }, "user");

    const res = await env.factory.release(projectId(), { issueNumber: issue.number }, "pm");
    expect(res).toMatchObject({ held: true });
    expect(labels(issue.number)).toContain(FACTORY_HOLD_LABEL);
    expect(env.factory.data.loopOrNew(projectId()).holds).toEqual([
      expect.objectContaining({ issueNumber: issue.number, by: "user", reason: "my call" }),
    ]);

    // The person releases their own.
    const mine = await env.factory.release(projectId(), { issueNumber: issue.number }, "user");
    expect(mine).toMatchObject({ held: false });
    expect(labels(issue.number)).not.toContain(FACTORY_HOLD_LABEL);
  });

  it("still lets the PM release a hold it placed, and a person release any", async () => {
    env = createFactoryEnv();
    s.enable();
    const own = openIssue("Add CSV export");
    const theirs = openIssue("Add JSON export", true);
    await env.factory.hold(projectId(), { issueNumber: own.number, reason: "waiting" }, "pm");

    expect(await env.factory.release(projectId(), { issueNumber: own.number }, "pm")).toMatchObject(
      { held: false },
    );
    expect(labels(own.number)).not.toContain(FACTORY_HOLD_LABEL);
    expect(
      await env.factory.release(projectId(), { issueNumber: theirs.number }, "user"),
    ).toMatchObject({ held: false });
    expect(labels(theirs.number)).not.toContain(FACTORY_HOLD_LABEL);

    // One that isn't held is answered as before.
    const free = openIssue("Add XML export");
    const res = await env.factory.release(projectId(), { issueNumber: free.number }, "pm");
    expect(res.message).toMatch(/wasn't held/);
  });

  it("never takes or puts the hold label through the PM's triage tool", async () => {
    const triage = vi.fn(async () => ({ decision: "ready" }));
    const services = {
      projects: { get: () => ({ id: "p1", name: "Demo", kind: "github" }) },
      orchestration: { github: { triageIssue: triage } },
    } as unknown as AppServices;
    const ctx = {
      services,
      sessionId: null,
      projectId: "p1",
      role: "pm",
      caller: "mcp",
      signal: new AbortController().signal,
    } as ServerToolContext<"project">;
    const call = (labels: { labels?: string[]; removeLabels?: string[] }) =>
      triageIssue.handler({ number: 7, decision: "ready", ...labels }, ctx);

    for (const labels of [
      { removeLabels: [FACTORY_HOLD_LABEL] },
      { removeLabels: ["bug", " Factory:Hold "] },
      { labels: [FACTORY_HOLD_LABEL] },
    ]) {
      await expect(call(labels), JSON.stringify(labels)).rejects.toThrow(/isn't a triage label/);
    }
    expect(triage).not.toHaveBeenCalled();
    // Any other label goes through as before.
    await call({ labels: ["feature"], removeLabels: ["needs-info", "factory:holding"] });
    expect(triage).toHaveBeenCalledTimes(1);
  });
});
