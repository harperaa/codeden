import {
  type DevPreviewConfig,
  type DevPreviewProject,
  type DevPreviewState,
  devPreviewBaseKey,
  hardenDevPreviewRecommended,
} from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DevPreviewPmBar } from "@/components/harden/dev-preview/bar";
import { DevPreviewProjectSettings } from "@/components/harden/dev-preview/project-settings";
import type { CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";
import { renderWithClient } from "./utils";

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn() }),
);
vi.mock("sonner", () => ({ toast }));

const PROJECT = "p-codeharden";
const project = { id: PROJECT } as Parameters<typeof DevPreviewProjectSettings>[0]["project"];
const recommended = hardenDevPreviewRecommended();
const view = (over: Partial<DevPreviewProject> = {}): DevPreviewProject => ({
  projectId: PROJECT,
  config: null,
  suggestion: null,
  recommended,
  baseBranch: "harden",
  notice: null,
  remote: false,
  ...over,
});
/** What the owner had stored: the right command with the form's default port variable. */
const wrongPorts: DevPreviewConfig = {
  ...recommended.settings,
  portVars: ["PORT"],
  confirmedAt: "2026-11-24T10:00:00.000Z",
  baseBranch: "harden",
};
const baseState = (over: Partial<DevPreviewState> = {}): DevPreviewState => ({
  key: devPreviewBaseKey(PROJECT),
  kind: "base",
  projectId: PROJECT,
  sessionId: null,
  status: "off",
  enabled: true,
  url: null,
  ports: [],
  message: null,
  logTail: [],
  startedAt: null,
  configured: true,
  unavailable: null,
  remote: false,
  base: { branch: "harden", commit: null, checkedAt: null, blocked: false },
  ...over,
});

function clientWith(api: Partial<CodeDenClient["devPreview"]>): CodeDenClient {
  const client = createMockClient();
  return { ...client, devPreview: { ...client.devPreview, ...api } };
}
const value = (testId: string) => (screen.getByTestId(testId) as HTMLInputElement).value;

describe("the dev preview settings of a checkout of this repository", () => {
  it("open with the four values filled in and Save…, and store nothing before the confirmation", async () => {
    const confirmProject = vi.fn(async () => view());
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith({ project: async () => view(), confirmProject }),
    );
    await waitFor(() =>
      expect(value("dev-preview-command")).toBe("node scripts/harden/dev-preview/run.mjs"),
    );
    expect(value("dev-preview-prepare")).toBe("pnpm install --frozen-lockfile");
    expect(value("dev-preview-port-vars")).toBe("WEB_PORT, API_PORT");
    expect(screen.getByRole("button", { name: "First port" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("dev-preview-recommended").textContent).toContain(
      "The fields below are filled in with the values that work for it. Nothing is stored or run until you confirm them.",
    );
    // No typing: the form's own button, which asks first. It starts nothing by itself: the PM
    // thread's preview is off until the person switches it on.
    const start = screen.getByTestId("dev-preview-save") as HTMLButtonElement;
    expect(start.textContent).toBe("Save…");
    expect(recommended.settings.pmEnabled).toBe(false);
    expect(start.disabled).toBe(false);
    expect(confirmProject).not.toHaveBeenCalled();
    fireEvent.click(start);
    const dialog = await screen.findByTestId("dev-preview-confirm");
    expect(dialog.textContent).toContain("node scripts/harden/dev-preview/run.mjs");
    expect(dialog.textContent).toContain("Ports go in WEB_PORT, API_PORT.");
    expect(confirmProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("dev-preview-confirm-run"));
    await waitFor(() => expect(confirmProject).toHaveBeenCalledWith(PROJECT, recommended.settings));
  });

  it("stay editable, and Fill them in puts the values back", async () => {
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith({ project: async () => view() }),
    );
    await waitFor(() => expect(value("dev-preview-port-vars")).toBe("WEB_PORT, API_PORT"));
    fireEvent.change(screen.getByTestId("dev-preview-port-vars"), { target: { value: "PORT" } });
    expect(value("dev-preview-port-vars")).toBe("PORT");
    fireEvent.click(screen.getByTestId("dev-preview-recommended-fill"));
    expect(value("dev-preview-port-vars")).toBe("WEB_PORT, API_PORT");
    expect(screen.queryByTestId("dev-preview-recommended-fill")).toBeNull();
  });

  it("say when the stored port variables can't work, and fill in the recommended ones to confirm", async () => {
    const confirmProject = vi.fn(async () => view({ config: wrongPorts }));
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith({
        project: async () => view({ config: wrongPorts }),
        base: async () => baseState({ status: "failed" }),
        confirmProject,
      }),
    );
    const hint = await screen.findByTestId("dev-preview-recommended-ports");
    expect(hint.textContent).toContain("reads its ports from WEB_PORT, API_PORT");
    expect(value("dev-preview-port-vars")).toBe("PORT");
    fireEvent.click(screen.getByText("Use the recommended settings"));
    expect(value("dev-preview-port-vars")).toBe("WEB_PORT, API_PORT");
    // Filling in changed the form only: the person still confirms.
    expect(confirmProject).not.toHaveBeenCalled();
    const save = screen.getByTestId("dev-preview-save");
    expect(save.textContent).toBe("Save changes…");
    fireEvent.click(save);
    fireEvent.click(await screen.findByTestId("dev-preview-confirm-run"));
    await waitFor(() => expect(confirmProject).toHaveBeenCalledWith(PROJECT, recommended.settings));
  });

  it("say nothing once the stored settings are the recommended ones, or for another project", async () => {
    const stored = { ...wrongPorts, portVars: recommended.settings.portVars };
    const first = renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith({ project: async () => view({ config: stored }) }),
    );
    await screen.findByTestId("dev-preview-command");
    expect(screen.queryByTestId("dev-preview-recommended-ports")).toBeNull();
    expect(screen.queryByTestId("dev-preview-recommended")).toBeNull();
    first.unmount();
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith({ project: async () => view({ recommended: null }) }),
    );
    await screen.findByTestId("dev-preview-command");
    expect(value("dev-preview-command")).toBe("");
    expect(value("dev-preview-port-vars")).toBe("PORT");
    expect(screen.queryByTestId("dev-preview-recommended")).toBeNull();
  });
});

describe("the PM thread's strip", () => {
  it("asks for the recommended settings when it is switched on, and starts with them", async () => {
    const confirmProject = vi.fn(async () => view());
    renderWithClient(
      <DevPreviewPmBar projectId={PROJECT} />,
      clientWith({
        base: async () => baseState({ configured: false, enabled: false }),
        project: async () => view(),
        confirmProject,
      }),
    );
    const toggle = await screen.findByTestId("dev-preview-switch");
    await waitFor(() => expect(toggle).toHaveProperty("disabled", false));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    // A recommendation exists, so the strip doesn't send the person to the settings.
    expect(screen.queryByTestId("dev-preview-hint")).toBeNull();
    fireEvent.click(toggle);
    const dialog = await screen.findByTestId("dev-preview-confirm");
    expect(dialog.textContent).toContain("node scripts/harden/dev-preview/run.mjs");
    expect(dialog.textContent).toContain("pnpm install --frozen-lockfile");
    expect(dialog.textContent).toContain("Ports go in WEB_PORT, API_PORT.");
    expect(dialog.textContent).toContain("The link opens the first port.");
    expect(dialog.textContent).toContain("A CodeHarden checkout");
    expect(screen.getByTestId("dev-preview-confirm-edit").getAttribute("href")).toBe(
      `/projects/${PROJECT}?tab=settings#dev-preview`,
    );
    expect(confirmProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("dev-preview-confirm-run"));
    // Stored with the PM thread's preview on, which is what starts it: the person's switch.
    await waitFor(() =>
      expect(confirmProject).toHaveBeenCalledWith(PROJECT, {
        ...recommended.settings,
        pmEnabled: true,
      }),
    );
  });

  it("points to the settings when the dev command stopped for a missing port variable", async () => {
    renderWithClient(
      <DevPreviewPmBar projectId={PROJECT} />,
      clientWith({
        base: async () =>
          baseState({
            status: "failed",
            message: "The dev command exited with code 2.",
            logTail: ["dev-preview: set API_PORT to a free port (1024-65535)."],
          }),
      }),
    );
    const link = await screen.findByTestId("dev-preview-fix-ports");
    expect(link.getAttribute("href")).toBe(`/projects/${PROJECT}?tab=settings#dev-preview`);
  });
});
