import {
  DEV_PREVIEW_NO_PREPARE_HINT,
  type DevPreviewProject,
  type DevPreviewState,
  devPreviewBaseKey,
  devPreviewSessionKey,
  type Session,
} from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DevPreviewBar, DevPreviewPmBar } from "@/components/harden/dev-preview/bar";
import { settingsOf } from "@/components/harden/dev-preview/form";
import { DevPreviewLimitsSettings } from "@/components/harden/dev-preview/limits-settings";
import { DevPreviewProjectSettings } from "@/components/harden/dev-preview/project-settings";
import type { CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";
import { makeSession } from "@/lib/api/mock/fixtures/helpers";
import { renderWithClient } from "./utils";

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn() }),
);
vi.mock("sonner", () => ({ toast }));

const PROJECT = "p-storefront";
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
const pm: Session = { ...agent, id: "s-pm", role: "pm" };

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
  configured: true,
  unavailable: null,
  remote: false,
  base: null,
  ...over,
});
const baseState = (over: Partial<DevPreviewState> = {}): DevPreviewState =>
  sessionState({
    key: devPreviewBaseKey(PROJECT),
    kind: "base",
    sessionId: null,
    base: { branch: "harden", commit: "0123456789", checkedAt: null, blocked: false },
    ...over,
  });

function clientWith(api: Partial<CodeDenClient["devPreview"]>): CodeDenClient {
  const client = createMockClient();
  return { ...client, devPreview: { ...client.devPreview, ...api } };
}

describe("the preview bar on a session", () => {
  it("is off by default, and the switch starts the session's preview", async () => {
    const startSession = vi.fn(async () =>
      sessionState({ status: "starting", enabled: true, ports: [43100] }),
    );
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({ session: async () => sessionState(), startSession }),
    );
    const toggle = await screen.findByTestId("dev-preview-switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("dev-preview-url")).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(startSession).toHaveBeenCalledWith(agent.id));
    expect((await screen.findByTestId("dev-preview-status")).textContent).toBe("Starting");
    // No link until something listens.
    expect(screen.queryByTestId("dev-preview-url")).toBeNull();
  });

  it("shows the link while it runs, and the switch stops it", async () => {
    const stopSession = vi.fn(async () => sessionState());
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({
        session: async () =>
          sessionState({ status: "running", enabled: true, url: "http://localhost:43100/" }),
        stopSession,
      }),
    );
    const link = await screen.findByTestId("dev-preview-url");
    expect(link.textContent).toBe("http://localhost:43100");
    expect(link.getAttribute("href")).toBe("http://localhost:43100/");
    fireEvent.click(screen.getByTestId("dev-preview-switch"));
    await waitFor(() => expect(stopSession).toHaveBeenCalledWith(agent.id));
  });

  it("shows why it failed, with the end of the log and a way to start it again", async () => {
    const startSession = vi.fn(async () => sessionState({ status: "starting", enabled: true }));
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({
        session: async () =>
          sessionState({
            status: "failed",
            enabled: true,
            message: "The prepare command exited with code 1.",
            logTail: ["ERR_PNPM_OUTDATED_LOCKFILE"],
          }),
        startSession,
      }),
    );
    expect((await screen.findByTestId("dev-preview-message")).textContent).toBe(
      "The prepare command exited with code 1.",
    );
    expect(screen.getByTestId("dev-preview-tail").textContent).toContain(
      "ERR_PNPM_OUTDATED_LOCKFILE",
    );
    fireEvent.click(screen.getByTestId("dev-preview-restart"));
    await waitFor(() => expect(startSession).toHaveBeenCalled());
  });

  it("says that a prepare command is missing, with the way to the settings, when the server hints at it", async () => {
    const failure = "The dev command exited with code 127 before anything was listening.";
    const failed = (message: string) =>
      sessionState({
        status: "failed",
        enabled: true,
        message,
        logTail: ["$ npm run dev", "sh: next: command not found"],
      });
    const hinted = renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({ session: async () => failed(`${failure} ${DEV_PREVIEW_NO_PREPARE_HINT}`) }),
    );
    // The failure itself, then the hint in a place of its own and the link.
    expect((await screen.findByTestId("dev-preview-message")).textContent).toBe(failure);
    expect(screen.getByTestId("dev-preview-needs-prepare").textContent).toBe(
      DEV_PREVIEW_NO_PREPARE_HINT,
    );
    expect(screen.getByTestId("dev-preview-fix-prepare").getAttribute("href")).toBe(
      `/projects/${PROJECT}?tab=settings#dev-preview`,
    );
    hinted.unmount();
    // The same failure in a project with a prepare command comes without the hint.
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({ session: async () => failed(failure) }),
    );
    expect((await screen.findByTestId("dev-preview-message")).textContent).toBe(failure);
    expect(screen.queryByTestId("dev-preview-needs-prepare")).toBeNull();
    expect(screen.queryByTestId("dev-preview-fix-prepare")).toBeNull();
  });

  it("is disabled with the reason for a session that has no worktree", async () => {
    const reason = "This session works in the project folder, not in a worktree of its own.";
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({ session: async () => sessionState({ unavailable: reason }) }),
    );
    const toggle = await screen.findByTestId("dev-preview-switch");
    expect(toggle).toHaveProperty("disabled", true);
    expect(screen.getByTestId("dev-preview-blocked").textContent).toBe(reason);
  });

  it("can't be started from another device, where the address is shown but isn't a link", async () => {
    const view = renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({ session: async () => sessionState({ remote: true }) }),
    );
    expect(await screen.findByTestId("dev-preview-switch")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("dev-preview-blocked").textContent).toMatch(
      /computer running the app/,
    );
    view.unmount();
    renderWithClient(
      <DevPreviewBar session={agent} />,
      clientWith({
        session: async () =>
          sessionState({
            remote: true,
            status: "running",
            enabled: true,
            url: "http://localhost:43100/",
          }),
      }),
    );
    const address = await screen.findByTestId("dev-preview-url");
    expect(address.tagName).toBe("SPAN");
    // It can still be switched off from there.
    expect(screen.getByTestId("dev-preview-switch")).toHaveProperty("disabled", false);
  });

  it("shows nothing on the orchestrator, which has no project", async () => {
    const session = vi.fn(async () => sessionState());
    const base = vi.fn(async () => baseState());
    renderWithClient(
      <DevPreviewBar session={{ ...agent, role: "orchestrator", projectId: null }} />,
      clientWith({ base, session }),
    );
    expect(base).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dev-preview-bar")).toBeNull();
  });
});

describe("the preview bar on the PM thread", () => {
  it("shows the base branch's preview, with its link and Update now", async () => {
    const updateBase = vi.fn(async () => baseState({ status: "running", enabled: true }));
    const base = vi.fn(async () =>
      baseState({ status: "running", enabled: true, url: "http://localhost:43101/" }),
    );
    renderWithClient(<DevPreviewBar session={pm} />, clientWith({ base, updateBase }));
    expect((await screen.findByTestId("dev-preview-url")).textContent).toBe(
      "http://localhost:43101",
    );
    expect(base).toHaveBeenCalledWith(PROJECT);
    expect(screen.getByTestId("dev-preview-base").textContent).toBe("harden @ 0123456");
    fireEvent.click(screen.getByText("Update now"));
    await waitFor(() => expect(updateBase).toHaveBeenCalledWith(PROJECT));
  });

  it("switching it off is the project's choice", async () => {
    const setPm = vi.fn(async () => baseState());
    renderWithClient(
      <DevPreviewPmBar projectId={PROJECT} />,
      clientWith({ base: async () => baseState({ status: "running", enabled: true }), setPm }),
    );
    fireEvent.click(await screen.findByTestId("dev-preview-switch"));
    await waitFor(() => expect(setPm).toHaveBeenCalledWith(PROJECT, false));
  });
});
// A project with nothing stored yet: `dev-preview-switch.test.tsx`.

describe("the project's dev preview settings", () => {
  const project = { id: PROJECT } as Parameters<typeof DevPreviewProjectSettings>[0]["project"];
  const view = (over: Partial<DevPreviewProject> = {}): DevPreviewProject => ({
    projectId: PROJECT,
    config: null,
    suggestion: {
      command: "pnpm dev",
      prepareCommand: "pnpm install --frozen-lockfile",
      reason: "package.json has a dev script",
    },
    recommended: null,
    baseBranch: "harden",
    notice: null,
    remote: false,
    ...over,
  });

  it("a suggestion only fills the fields: nothing is stored until the person confirms", async () => {
    const confirmProject = vi.fn(async () => view());
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith({ project: async () => view(), confirmProject }),
    );
    const command = (await screen.findByTestId("dev-preview-command")) as HTMLInputElement;
    const prepare = screen.getByTestId("dev-preview-prepare") as HTMLInputElement;
    expect(command.value).toBe("");
    // One offer for both, at the dev command; not a second one at the prepare command.
    expect(screen.queryByTestId("dev-preview-prepare-suggestion")).toBeNull();
    fireEvent.click(screen.getByText("Fill it in"));
    expect(command.value).toBe("pnpm dev");
    expect(prepare.value).toBe("pnpm install --frozen-lockfile");
    expect(screen.queryByText("Fill it in")).toBeNull();
    expect(confirmProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("dev-preview-save"));
    // The dialog shows exactly what would run; still nothing stored.
    const dialog = await screen.findByTestId("dev-preview-confirm");
    expect(dialog.textContent).toContain("pnpm dev");
    expect(dialog.textContent).toContain("pnpm install --frozen-lockfile");
    expect(confirmProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("dev-preview-confirm")).toBeNull());
    expect(confirmProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("dev-preview-save"));
    fireEvent.click(await screen.findByTestId("dev-preview-confirm-run"));
    await waitFor(() =>
      expect(confirmProject).toHaveBeenCalledWith(PROJECT, {
        command: "pnpm dev",
        prepareCommand: "pnpm install --frozen-lockfile",
        portVars: ["PORT"],
        urlFrom: "port",
        urlPattern: null,
        // Nobody switched "On the PM thread" on, so no preview starts by itself.
        pmEnabled: false,
      }),
    );
  });

  it("offers the prepare command for stored settings that have none, and stores it only on confirmation", async () => {
    const config = {
      command: "npm run dev",
      prepareCommand: null,
      portVars: ["PORT"],
      urlFrom: "port" as const,
      urlPattern: null,
      pmEnabled: true,
      confirmedAt: "2026-11-23T10:00:00.000Z",
      baseBranch: "harden",
    };
    const suggestion = {
      command: "npm run dev",
      prepareCommand: "npm ci",
      reason: "package.json has a dev script",
    };
    const confirmProject = vi.fn(async () => view({ config, suggestion: null }));
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith({ project: async () => view({ config, suggestion }), confirmProject }),
    );
    const offer = await screen.findByTestId("dev-preview-prepare-suggestion");
    expect(offer.textContent).toContain("npm ci");
    // The dev command is stored already: nothing is offered for it.
    expect(screen.queryByTestId("dev-preview-suggestion")).toBeNull();
    const prepare = screen.getByTestId("dev-preview-prepare") as HTMLInputElement;
    expect(prepare.value).toBe("");
    fireEvent.click(screen.getByText("Fill it in"));
    expect(prepare.value).toBe("npm ci");
    expect(screen.queryByTestId("dev-preview-prepare-suggestion")).toBeNull();
    expect(confirmProject).not.toHaveBeenCalled();

    const save = screen.getByTestId("dev-preview-save");
    expect(save.textContent).toBe("Save changes…");
    fireEvent.click(save);
    expect((await screen.findByTestId("dev-preview-confirm")).textContent).toContain("npm ci");
    expect(confirmProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("dev-preview-confirm-run"));
    await waitFor(() =>
      expect(confirmProject).toHaveBeenCalledWith(PROJECT, {
        command: "npm run dev",
        prepareCommand: "npm ci",
        portVars: ["PORT"],
        urlFrom: "port",
        urlPattern: null,
        pmEnabled: true,
      }),
    );
  });

  it("says what is wrong instead of asking, and has nothing to save when nothing changed", async () => {
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith({ project: async () => view({ suggestion: null }) }),
    );
    const save = await screen.findByTestId("dev-preview-save");
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByTestId("dev-preview-port-vars"), {
      target: { value: "PORT, PATH" },
    });
    fireEvent.click(save);
    expect((await screen.findByRole("alert")).textContent).toBe("Enter the dev command.");
    fireEvent.change(screen.getByTestId("dev-preview-command"), { target: { value: "pnpm dev" } });
    fireEvent.click(save);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Port variables/);
    expect(screen.queryByTestId("dev-preview-confirm")).toBeNull();
  });

  it("is read-only on another device", async () => {
    const config = {
      command: "pnpm dev",
      prepareCommand: null,
      portVars: ["PORT"],
      urlFrom: "port" as const,
      urlPattern: null,
      pmEnabled: true,
      confirmedAt: "2026-11-23T10:00:00.000Z",
      baseBranch: "harden",
    };
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith({ project: async () => view({ remote: true, config, suggestion: null }) }),
    );
    expect(await screen.findByTestId("dev-preview-remote")).toBeTruthy();
    const command = screen.getByTestId("dev-preview-command") as HTMLInputElement;
    await waitFor(() => expect(command.value).toBe("pnpm dev"));
    expect(command.disabled).toBe(true);
    expect(screen.queryByTestId("dev-preview-save")).toBeNull();
    expect(screen.queryByTestId("dev-preview-remove")).toBeNull();
  });

  it("lets the same settings be confirmed again when the project's base branch changed", async () => {
    const config = {
      command: "pnpm dev",
      prepareCommand: null,
      portVars: ["PORT"],
      urlFrom: "port" as const,
      urlPattern: null,
      pmEnabled: true,
      confirmedAt: "2026-11-23T10:00:00.000Z",
      baseBranch: "harden",
    };
    const confirmProject = vi.fn(async () => view({ config, suggestion: null }));
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith({
        project: async () => view({ config, suggestion: null, baseBranch: "release" }),
        confirmProject,
      }),
    );
    expect((await screen.findByTestId("dev-preview-branch-changed")).textContent).toMatch(
      /now release.*confirmed for harden/,
    );
    const save = screen.getByTestId("dev-preview-save");
    expect(save).toHaveProperty("disabled", false);
    expect(save.textContent).toBe("Confirm again…");
    fireEvent.click(save);
    expect((await screen.findByTestId("dev-preview-confirm")).textContent).toContain("(release)");
    fireEvent.click(screen.getByTestId("dev-preview-confirm-run"));
    await waitFor(() => expect(confirmProject).toHaveBeenCalled());
  });

  it("turns the form into settings", () => {
    const form = {
      command: " node dev.mjs ",
      prepareCommand: "  ",
      portVars: "WEB_PORT,  API_PORT",
      urlFrom: "output" as const,
      urlPattern: "",
      pmEnabled: false,
    };
    expect(settingsOf(form)).toEqual({
      ok: true,
      settings: {
        command: "node dev.mjs",
        prepareCommand: null,
        portVars: ["WEB_PORT", "API_PORT"],
        urlFrom: "output",
        urlPattern: null,
        pmEnabled: false,
      },
    });
    expect(settingsOf({ ...form, urlPattern: "(" })).toMatchObject({ ok: false });
  });
});

describe("the limits in the app's settings", () => {
  it("shows them, and Stop all stops every preview", async () => {
    const stopAll = vi.fn(async () => ({ stopped: 2 }));
    renderWithClient(<DevPreviewLimitsSettings />, clientWith({ stopAll }));
    const perProject = (await screen.findByLabelText(
      "Previews at once in a project",
    )) as HTMLInputElement;
    expect(perProject.value).toBe("3");
    expect(
      (screen.getByLabelText("Previews at once in all projects") as HTMLInputElement).value,
    ).toBe("6");
    fireEvent.click(screen.getByTestId("dev-preview-stop-all"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Stopped 2 previews"));
  });

  it("are read-only on another device", async () => {
    renderWithClient(
      <DevPreviewLimitsSettings />,
      clientWith({
        limits: async () => ({
          limits: { perProject: 3, total: 6, portFrom: 43100, portTo: 43199 },
          remote: true,
        }),
      }),
    );
    expect(await screen.findByLabelText("First port")).toHaveProperty("disabled", true);
  });
});
