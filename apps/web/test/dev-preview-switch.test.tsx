import {
  type DevPreviewProject,
  type DevPreviewState,
  devPreviewBaseKey,
  devPreviewSessionKey,
  SECURE_FOUNDATION_NO_DEV_PREVIEW,
  type SecureFoundationDevPreview,
  type Session,
  secureFoundationDevPreview,
} from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DevPreviewBar, DevPreviewPmBar } from "@/components/harden/dev-preview/bar";
import { devPreviewOffer } from "@/components/harden/dev-preview/setup";
import type { CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";
import { makeSession } from "@/lib/api/mock/fixtures/helpers";
import { renderWithClient } from "./utils";

/**
 * The switch at the top of a thread in a project that has no dev preview settings yet. It is
 * there and off; switching it on asks with the settings the app can offer, or leads to the
 * project's settings when it can offer none. Nothing is stored except from the confirmation.
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

const PROJECT = "p-storefront";
const SETTINGS = `/projects/${PROJECT}?tab=settings#dev-preview`;
const agent: Session = makeSession({
  id: "s-checkout",
  projectId: PROJECT,
  role: "agent",
  status: "idle",
  provider: "claude",
  model: "opus",
  purpose: "Checkout",
  workKey: "issue:142",
});

/** A thread's preview in a project with nothing stored. */
const sessionState = (over: Partial<DevPreviewState> = {}): DevPreviewState => ({
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
  ...over,
});
const baseState = (over: Partial<DevPreviewState> = {}): DevPreviewState =>
  sessionState({ key: devPreviewBaseKey(PROJECT), kind: "base", sessionId: null, ...over });
const view = (over: Partial<DevPreviewProject> = {}): DevPreviewProject => ({
  projectId: PROJECT,
  config: null,
  suggestion: {
    command: "pnpm dev",
    prepareCommand: "pnpm install --frozen-lockfile",
    reason: "package.json has a dev script",
  },
  recommended: null,
  baseBranch: "main",
  notice: null,
  remote: false,
  ...over,
});
const suggested = {
  command: "pnpm dev",
  prepareCommand: "pnpm install --frozen-lockfile" as string | null,
  portVars: ["PORT"],
  urlFrom: "port" as const,
  urlPattern: null,
};

function clientWith(
  api: Partial<CodeDenClient["devPreview"]>,
  offer: SecureFoundationDevPreview = SECURE_FOUNDATION_NO_DEV_PREVIEW,
): CodeDenClient {
  const client = createMockClient();
  return {
    ...client,
    devPreview: { ...client.devPreview, ...api },
    secureFoundation: { ...client.secureFoundation, devPreview: async () => offer },
  };
}
/** The switch, once the strip knows what it can offer. */
async function ready() {
  const toggle = await screen.findByTestId("dev-preview-switch");
  await waitFor(() => expect(toggle).toHaveProperty("disabled", false));
  return toggle;
}

describe("a session's switch in a project with nothing stored", () => {
  it("is there and off, asks with the offered command, and stores nothing on Cancel", async () => {
    const confirmProject = vi.fn(async () => view());
    const startSession = vi.fn(async () => sessionState({ configured: true }));
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({
        session: async () => sessionState(),
        project: async () => view(),
        confirmProject,
        startSession,
      }),
    );
    const toggle = await ready();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("dev-preview-status")).toBeNull();
    expect(screen.queryByTestId("dev-preview-hint")).toBeNull();

    fireEvent.click(toggle);
    const dialog = await screen.findByTestId("dev-preview-confirm");
    expect(dialog.textContent).toContain("Run these commands on this computer?");
    expect(dialog.textContent).toContain("pnpm dev");
    // The install command for the same lockfile is shown with it, so nothing is missing.
    expect(dialog.textContent).toContain("Prepare command");
    expect(dialog.textContent).toContain("pnpm install --frozen-lockfile");
    expect(dialog.textContent).not.toContain("There is no prepare command");
    expect(dialog.textContent).toContain("Ports go in PORT.");
    expect(dialog.textContent).toContain("No preview starts for the PM thread.");
    expect(dialog.textContent).toContain("This session's preview starts once you allow them.");
    expect(screen.getByTestId("dev-preview-confirm-edit").getAttribute("href")).toBe(SETTINGS);

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("dev-preview-confirm")).toBeNull());
    expect(confirmProject).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("dev-preview-switch").getAttribute("aria-checked")).toBe("false");
  });

  it("Save and allow stores the offered settings, PM thread off, then starts this session's preview", async () => {
    const order: string[] = [];
    const confirmProject = vi.fn(async () => {
      order.push("stored");
      return view();
    });
    const startSession = vi.fn(async () => {
      order.push("started");
      return sessionState({ configured: true, status: "starting", enabled: true });
    });
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({
        session: async () => sessionState(),
        project: async () => view(),
        confirmProject,
        startSession,
      }),
    );
    fireEvent.click(await ready());
    fireEvent.click(await screen.findByTestId("dev-preview-confirm-run"));
    await waitFor(() => expect(startSession).toHaveBeenCalledWith(agent.id));
    expect(confirmProject).toHaveBeenCalledWith(PROJECT, { ...suggested, pmEnabled: false });
    expect(order).toEqual(["stored", "started"]);
    await waitFor(() => expect(screen.queryByTestId("dev-preview-confirm")).toBeNull());
  });

  it("warns that there is no prepare command only when the offer really has none", async () => {
    const confirmProject = vi.fn(async () => view());
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({
        session: async () => sessionState(),
        // A dev script and no lockfile the app knows: no install command to offer.
        project: async () =>
          view({
            suggestion: {
              command: "npm run dev",
              prepareCommand: null,
              reason: "package.json has a dev script",
            },
          }),
        confirmProject,
        startSession: async () => sessionState({ configured: true }),
      }),
    );
    fireEvent.click(await ready());
    const dialog = await screen.findByTestId("dev-preview-confirm");
    expect(dialog.textContent).toContain("There is no prepare command");
    expect(dialog.textContent).not.toContain("Prepare command");
    fireEvent.click(screen.getByTestId("dev-preview-confirm-run"));
    await waitFor(() =>
      expect(confirmProject).toHaveBeenCalledWith(PROJECT, {
        ...suggested,
        command: "npm run dev",
        prepareCommand: null,
        pmEnabled: false,
      }),
    );
  });

  it("Edit settings in the dialog opens the project's settings and stores nothing", async () => {
    const confirmProject = vi.fn(async () => view());
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({
        session: async () => sessionState(),
        project: async () => view(),
        confirmProject,
      }),
    );
    fireEvent.click(await ready());
    fireEvent.click(await screen.findByTestId("dev-preview-confirm-edit"));
    expect(push).toHaveBeenCalledWith(SETTINGS);
    await waitFor(() => expect(screen.queryByTestId("dev-preview-confirm")).toBeNull());
    expect(confirmProject).not.toHaveBeenCalled();
  });

  it("without anything to offer, says a dev command is needed and leads to the settings", async () => {
    const confirmProject = vi.fn(async () => view());
    const startSession = vi.fn(async () => sessionState());
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({
        session: async () => sessionState(),
        project: async () => view({ suggestion: null }),
        confirmProject,
        startSession,
      }),
    );
    const toggle = await ready();
    expect(screen.getByTestId("dev-preview-needs-command").textContent).toBe(
      "Needs a dev command first.",
    );
    expect(screen.getByTestId("dev-preview-hint").getAttribute("href")).toBe(SETTINGS);
    fireEvent.click(toggle);
    expect(push).toHaveBeenCalledWith(SETTINGS);
    // No command is guessed: nothing is asked, stored or started.
    expect(screen.queryByTestId("dev-preview-confirm")).toBeNull();
    expect(confirmProject).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it.each([
    ["has no worktree", { unavailable: "This session works in the project folder." }],
    ["is on another device", { remote: true }],
  ])("stays disabled with its reason when the session %s, and offers nothing", async (_, over) => {
    const project = vi.fn(async () => view());
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({ session: async () => sessionState(over), project }),
    );
    const toggle = await screen.findByTestId("dev-preview-switch");
    expect(toggle).toHaveProperty("disabled", true);
    expect(screen.getByTestId("dev-preview-blocked").textContent).toMatch(
      /project folder|computer running the app/,
    );
    expect(screen.queryByTestId("dev-preview-hint")).toBeNull();
    expect(project).not.toHaveBeenCalled();
  });
});

describe("the PM thread's switch in a project with nothing stored", () => {
  it("is there and off: nothing starts by itself, and switching it on asks first", async () => {
    const confirmProject = vi.fn(async () => view());
    const setPm = vi.fn(async () => baseState());
    const updateBase = vi.fn(async () => baseState());
    renderWithClient(
      <DevPreviewPmBar projectId={PROJECT} />,
      clientWith({
        base: async () => baseState(),
        project: async () => view(),
        confirmProject,
        setPm,
        updateBase,
      }),
    );
    const toggle = await ready();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(setPm).not.toHaveBeenCalled();
    expect(updateBase).not.toHaveBeenCalled();
    expect(confirmProject).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    const dialog = await screen.findByTestId("dev-preview-confirm");
    expect(dialog.textContent).toContain(
      "A preview of the base branch (main) starts for the PM thread",
    );
    expect(setPm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("dev-preview-confirm-run"));
    // Storing them with the PM thread on is what starts it.
    await waitFor(() =>
      expect(confirmProject).toHaveBeenCalledWith(PROJECT, { ...suggested, pmEnabled: true }),
    );
  });

  it("leads to the settings when there is nothing to offer", async () => {
    renderWithClient(
      <DevPreviewPmBar projectId={PROJECT} />,
      clientWith({
        base: async () => baseState(),
        project: async () => view({ suggestion: null }),
      }),
    );
    fireEvent.click(await ready());
    expect(push).toHaveBeenCalledWith(SETTINGS);
    expect(screen.getByTestId("dev-preview-hint").textContent).toBe("Set up a dev preview");
  });
});

describe("what the switch offers", () => {
  const doppler = secureFoundationDevPreview({
    secrets: "doppler",
    doppler: { project: "my-site", config: "dev" },
  });

  it("is the Secure Foundation values first, then the recognised checkout, then the dev script", () => {
    const recommended = {
      settings: { ...suggested, command: "node run.mjs", pmEnabled: false },
      reason: "A CodeHarden checkout",
    };
    expect(devPreviewOffer(view({ recommended }), doppler)?.settings).toEqual(doppler.settings);
    const none = SECURE_FOUNDATION_NO_DEV_PREVIEW;
    expect(devPreviewOffer(view({ recommended }), none)).toEqual(recommended);
    expect(devPreviewOffer(view(), none)).toEqual({
      settings: { ...suggested, pmEnabled: false },
      reason: "package.json has a dev script",
    });
  });

  it("is nothing for stored settings, another device, or a Secure Foundation project without values", () => {
    const config = {
      ...suggested,
      pmEnabled: true,
      confirmedAt: "2026-11-24T10:00:00.000Z",
      baseBranch: "main",
    };
    const none = SECURE_FOUNDATION_NO_DEV_PREVIEW;
    expect(devPreviewOffer(view({ config }), none)).toBeNull();
    expect(devPreviewOffer(view({ remote: true }), none)).toBeNull();
    expect(devPreviewOffer(view({ suggestion: null }), none)).toBeNull();
    // The plain dev command would not be enough for such a project: the settings say why.
    expect(devPreviewOffer(view(), { ...doppler, settings: null })).toBeNull();
  });

  it("is nothing without both answers: a missing one never falls through to the dev script", () => {
    // `dev-preview-switch-lookups.test.tsx` has the strip with a lookup that failed.
    expect(devPreviewOffer(view(), undefined)).toBeNull();
    expect(devPreviewOffer(undefined, SECURE_FOUNDATION_NO_DEV_PREVIEW)).toBeNull();
    expect(devPreviewOffer(undefined, doppler)).toBeNull();
    expect(devPreviewOffer(undefined, undefined)).toBeNull();
  });
});
