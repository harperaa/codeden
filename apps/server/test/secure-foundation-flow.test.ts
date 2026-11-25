import { execFileSync } from "node:child_process";
import {
  CreateSecureFoundationRequest,
  type CreateSecureFoundationResponse,
  DevPreviewProject,
  isSecureFoundationSetup,
  RoleMessageResponse,
  SECURE_FOUNDATION_SETUP_AUTONOMY,
  SecureFoundationDevPreview,
  SecureFoundationOptions,
  SecureFoundationQuiet,
  type Session,
  StartSessionResponse,
  secureFoundationStatus,
} from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sameRealPath } from "../src/services/projects/detect";
import { createSecureFoundation } from "../src/services/secure-foundation";
import { holdsPmWakes } from "../src/services/secure-foundation/quiet";
import { type Harness, startHarness, waitUntil } from "./support/harness";
import { removeTree } from "./support/remove-tree";
import { makeTemplateFixture, type TemplateFixture } from "./support/secure-foundation-fixture";

/**
 * Secure Foundation end to end on a real server and runner with the Fake provider: the project
 * made from the fixture template, and its setup session running in the project folder.
 */
const EMAIL = "person@site.test";
let h: Harness;
let fixture: TemplateFixture;
/** The project the create test made, for the tests after it. */
let made: CreateSecureFoundationResponse;

beforeAll(async () => {
  fixture = makeTemplateFixture();
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
  await removeTree(fixture.root);
});

const SETTLED = new Set(["idle", "failed", "stopped", "completed", "interrupted"]);

describe("Secure Foundation with the Fake provider", () => {
  it("is behind the sign-in like every other route", async () => {
    const res = await fetch(`${h.server.url}/api/secure-foundation`);
    expect(res.status).toBe(401);
    const post = await fetch(`${h.server.url}/api/secure-foundation/projects`, { method: "POST" });
    expect(post.status).toBe(401);
  });

  it("offers the option with the signed-in providers", async () => {
    const options = SecureFoundationOptions.parse((await h.api("GET", "/secure-foundation")).body);
    expect(options.enabled).toBe(true);
    expect(options.providers.map((p) => p.id)).toContain("fake");
    expect(options.providers.find((p) => p.id === "fake")?.runsCommandFiles).toBe(false);
    expect(options.autonomy).toBe(SECURE_FOUNDATION_SETUP_AUTONOMY);
  });

  it("creates the project and runs its setup session in the project folder", async () => {
    const s = h.server.services;
    const service = createSecureFoundation({
      exec: (await import("../src/services/exec")).runTool,
      home: `${h.home}/made-home`,
      projectsDir: `${h.home}/made`,
      projects: s.projects,
      sessions: () => s.sessions,
      factory: () => s.factory,
      runner: s.runner,
      setup: s.setup,
      template: fixture.source,
    });
    const seqBefore = s.store.headSeq();
    const template = await service.template();
    await service.prefill();
    // Resolving and prefilling write nothing to the event log.
    expect(s.store.headSeq()).toBe(seqBefore);

    const result = await service.create(
      CreateSecureFoundationRequest.parse({
        name: "Flow Site",
        adminEmail: EMAIL,
        secrets: "env_local",
        provider: "fake",
        commit: template.commit,
      }),
    );
    made = result;
    // The service that made it kept the answers a dev preview depends on.
    const offer = service.devPreview(result.project.id, { setUp: () => false, baseCheckout: null });
    expect(offer.secrets).toBe("env_local");
    expect(offer.settings?.command).toBe("npm run dev");
    expect(result.project.name).toBe("Flow Site");
    expect(result.project.kind).toBe("local");
    // Quiet from the start: Manual mode, set before the setup session exists.
    expect(result.project.autonomyMode).toBe("manual");
    expect(s.projects.get(result.project.id).autonomyMode).toBe("manual");
    expect(result.project.isGitRepo).toBe(true);
    const count = execFileSync("git", ["-C", result.project.path, "rev-list", "--count", "HEAD"], {
      encoding: "utf8",
    });
    expect(count.trim()).toBe("1");

    const session: Session = await waitUntil(() => {
      const found = s.sessionRepo.get(result.sessionId);
      return SETTLED.has(found.status) && !s.sessions.launching.has(found.id) ? found : undefined;
    });
    expect(session.status).toBe("idle");
    expect(isSecureFoundationSetup(session)).toBe(true);
    expect(session.autonomy).toBe(SECURE_FOUNDATION_SETUP_AUTONOMY);
    expect(session.worktreePath).toBeNull();
    expect(sameRealPath(session.cwd, result.project.path)).toBe(true);
    // The Fake provider reports no progress: between turns the status asks the person to look.
    expect(secureFoundationStatus(session)).toEqual({ phase: "waiting", url: null });

    // The email is in the brief (the session's first message, which the Fake provider echoes)
    // and nowhere else: not in the project, the session's row or any event outside its transcript.
    expect(JSON.stringify([result.project, session])).not.toContain(EMAIL);
    const mentioning = s.store
      .listAfter(seqBefore, 100_000)
      .filter((e) => JSON.stringify(e).includes(EMAIL));
    expect(mentioning.length).toBeGreaterThan(0);
    for (const event of mentioning) {
      expect(event.sessionId).toBe(result.sessionId);
      expect(event.type.startsWith("agent."), event.type).toBe(true);
    }
  });

  it("is quiet, and still does what the person asks: a session by hand, a message to its project manager", async () => {
    const s = h.server.services;
    const projectId = made.project.id;
    expect(holdsPmWakes({ db: s.db, projects: s.projects }, projectId)).toBe(true);
    // The project page can ask, for when the setup session has left its snapshot.
    const quiet = async (id: string) =>
      SecureFoundationQuiet.parse(
        (await h.api("GET", `/secure-foundation/projects/${id}/quiet`)).body,
      );
    expect(await quiet(projectId)).toEqual({ quiet: true });
    expect(await quiet(h.projectId)).toEqual({ quiet: false });
    expect(await quiet("no-such-project")).toEqual({ quiet: false });

    // The dev preview's form is offered values for this project and for no other, and
    // offering them sets nothing up: the project still has no dev preview.
    const offer = async (id: string) =>
      SecureFoundationDevPreview.parse(
        (await h.api("GET", `/secure-foundation/projects/${id}/dev-preview`)).body,
      );
    // This server kept nothing for it (another service made it): its setup session tells.
    const offered = await offer(projectId);
    expect(offered.applies).toBe(true);
    expect(offered.settings?.prepareCommand).toBe("npm ci");
    expect((await offer(h.projectId)).applies).toBe(false);
    expect((await offer("no-such-project")).applies).toBe(false);
    const preview = DevPreviewProject.parse(
      (await h.api("GET", `/dev-preview/projects/${projectId}`)).body,
    );
    expect(preview.config).toBeNull();

    // A session the person starts by hand runs its turn.
    const started = StartSessionResponse.parse(
      (
        await h.api("POST", "/sessions", {
          projectId,
          provider: "fake",
          purpose: "By hand",
          input: { text: "hello" },
        })
      ).body,
    );
    if (started.status !== "started") throw new Error(`not started: ${started.status}`);
    await waitUntil(async () =>
      (await h.detail(started.sessionId)).session.status === "idle" ? true : undefined,
    );

    // An update for the project manager arrives while the project is quiet: it is kept.
    const notice = `pr.opened:${projectId}:7`;
    s.orchestration.notify({
      id: notice,
      type: "pr.opened",
      projectId,
      target: "pm",
      sessionId: null,
      title: "PR #7 opened: Bump left-pad",
      data: {
        sessionId: null,
        pr: { number: 7, url: "https://github.test/pr/7", state: "open", title: "Bump left-pad" },
      },
    });
    const kept = () => s.orchestration.notices.undelivered("pm", projectId).map((n) => n.id);
    expect(kept()).toContain(notice);
    expect(s.orchestration.roles.find("pm", projectId)).toBeUndefined();

    // The person's message starts the project manager, and its turn takes the update with it.
    const sent = RoleMessageResponse.parse(
      (
        await h.api("POST", `/orchestration/projects/${projectId}/pm/messages`, {
          input: { text: "hello pm" },
        })
      ).body,
    );
    await waitUntil(async () =>
      (await h.detail(sent.sessionId)).session.status === "idle" && !kept().includes(notice)
        ? true
        : undefined,
    );
    expect(s.orchestration.roles.find("pm", projectId)?.id).toBe(sent.sessionId);
  });
});
