import {
  type DevPreviewProject,
  type DevPreviewState,
  devPreviewSessionKey,
  hardenDevPreviewRecommended,
  SECURE_FOUNDATION_NO_DEV_PREVIEW,
  type SecureFoundationDevPreview,
  type Session,
  secureFoundationDevPreview,
} from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DevPreviewBar } from "@/components/harden/dev-preview/bar";
import type { CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";
import { makeSession } from "@/lib/api/mock/fixtures/helpers";
import { renderWithClient } from "./utils";

/**
 * The switch of a project with nothing stored asks two things before it offers settings: the
 * project's dev preview view, and whether Secure Foundation set the project up. Without both
 * answers it offers nothing; and what it offers for a Secure Foundation project comes with what
 * stays for the person to do.
 */
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn() }),
);
vi.mock("sonner", () => ({ toast }));
const push = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ history: { push } }),
}));
beforeEach(() => push.mockClear());

const PROJECT = "p-site";
const SETTINGS = `/projects/${PROJECT}?tab=settings#dev-preview`;
const agent: Session = makeSession({
  id: "s-landing",
  projectId: PROJECT,
  role: "agent",
  status: "idle",
  provider: "claude",
  model: "opus",
  purpose: "Landing page",
  workKey: "issue:7",
});
const state: DevPreviewState = {
  key: devPreviewSessionKey(agent.id),
  kind: "session",
  projectId: PROJECT,
  sessionId: agent.id,
  status: "off",
  enabled: false,
  url: null,
  ports: [],
  message: null,
  logTail: [],
  startedAt: null,
  configured: false,
  unavailable: null,
  remote: false,
  base: null,
};
/** A project with a `dev` script: on its own, the plain dev command would be offered. */
const view = (over: Partial<DevPreviewProject> = {}): DevPreviewProject => ({
  projectId: PROJECT,
  config: null,
  suggestion: {
    command: "npm run dev",
    prepareCommand: null,
    reason: "package.json has a dev script",
  },
  recommended: null,
  baseBranch: "main",
  notice: null,
  remote: false,
  ...over,
});
const withEnvLocal = secureFoundationDevPreview({ secrets: "env_local", doppler: null });

function show(lookups: {
  project: () => Promise<DevPreviewProject>;
  foundation: () => Promise<SecureFoundationDevPreview>;
}) {
  const client = createMockClient();
  const confirmProject = vi.fn(async () => view());
  const startSession = vi.fn(async () => ({ ...state, configured: true }));
  const withLookups: CodeDenClient = {
    ...client,
    devPreview: {
      ...client.devPreview,
      session: async () => state,
      project: lookups.project,
      confirmProject,
      startSession,
    },
    secureFoundation: { ...client.secureFoundation, devPreview: lookups.foundation },
  };
  renderWithClient(<DevPreviewBar session={agent} />, withLookups);
  return { confirmProject, startSession };
}
const failing = () => Promise.reject(new Error("The server didn't answer."));
/** The switch, once both lookups have ended one way or the other. */
async function ready() {
  const toggle = await screen.findByTestId("dev-preview-switch");
  await waitFor(() => expect(toggle).toHaveProperty("disabled", false));
  return toggle;
}

describe("a lookup that failed", () => {
  it("the Secure Foundation one: the dev script's command is not offered, and nothing can be stored", async () => {
    const foundation = vi.fn(failing);
    const { confirmProject, startSession } = show({ project: async () => view(), foundation });
    const toggle = await ready();
    expect(screen.getByTestId("dev-preview-check-failed").textContent).toBe(
      "Couldn't check this project's settings. Switch it on to try again.",
    );
    expect(screen.getByTestId("dev-preview-hint").getAttribute("href")).toBe(SETTINGS);
    expect(screen.queryByTestId("dev-preview-needs-command")).toBeNull();

    // Switching it on asks again; still no answer, so still no dialog and no guess.
    fireEvent.click(toggle);
    await waitFor(() => expect(foundation).toHaveBeenCalledTimes(2));
    await ready();
    expect(screen.queryByTestId("dev-preview-confirm")).toBeNull();
    expect(screen.queryByTestId("dev-preview-confirm-run")).toBeNull();
    expect(screen.getByTestId("dev-preview-check-failed")).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(confirmProject).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("the project's view: nothing is offered either, whatever Secure Foundation answered", async () => {
    const { confirmProject } = show({ project: failing, foundation: async () => withEnvLocal });
    const toggle = await ready();
    expect(screen.getByTestId("dev-preview-check-failed")).toBeTruthy();
    fireEvent.click(toggle);
    await ready();
    expect(screen.queryByTestId("dev-preview-confirm")).toBeNull();
    expect(confirmProject).not.toHaveBeenCalled();
  });

  it("asks again on the next switch, and offers what the answer then says", async () => {
    let answers = false;
    const foundation = vi.fn(() => (answers ? Promise.resolve(withEnvLocal) : failing()));
    const { confirmProject } = show({ project: async () => view(), foundation });
    const toggle = await ready();
    expect(screen.getByTestId("dev-preview-check-failed")).toBeTruthy();
    answers = true;
    fireEvent.click(toggle);
    // A Secure Foundation project after all: its values, not the dev script's bare command.
    const dialog = await screen.findByTestId("dev-preview-confirm");
    expect(dialog.textContent).toContain("npm ci");
    expect(dialog.textContent).toContain("A Secure Foundation project");
    expect(confirmProject).not.toHaveBeenCalled();
  });
});

describe("the notes of a Secure Foundation project in the switch's dialog", () => {
  it("are shown with its offer: what to copy, and that Convex runs separately", async () => {
    const { confirmProject } = show({
      project: async () => view(),
      foundation: async () => withEnvLocal,
    });
    fireEvent.click(await ready());
    await screen.findByTestId("dev-preview-confirm");
    const notes = screen.getByTestId("dev-preview-confirm-notes").textContent ?? "";
    // The server's own text, whole: the same the settings form shows.
    for (const note of withEnvLocal.notes) expect(notes).toContain(note.replaceAll("`", ""));
    expect(withEnvLocal.notes.join(" ")).toContain(".env.local");
    expect(withEnvLocal.convex).toBeTruthy();
    expect(notes).toContain((withEnvLocal.convex ?? "").replaceAll("`", ""));
    expect(screen.getByTestId("dev-preview-confirm-edit")).toBeTruthy();
    expect(confirmProject).not.toHaveBeenCalled();
  });

  it.each([
    ["a project with a dev script", view()],
    ["a checkout of this repository", view({ recommended: hardenDevPreviewRecommended() })],
  ])("are not shown for %s", async (_, project) => {
    show({
      project: async () => project,
      foundation: async () => SECURE_FOUNDATION_NO_DEV_PREVIEW,
    });
    fireEvent.click(await ready());
    await screen.findByTestId("dev-preview-confirm");
    expect(screen.queryByTestId("dev-preview-confirm-notes")).toBeNull();
  });
});
