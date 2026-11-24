import {
  type DevPreviewConfig,
  type DevPreviewProject,
  type DevPreviewState,
  devPreviewBaseKey,
  type Project,
} from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formChanged, formOf } from "@/components/harden/dev-preview/form";
import { DevPreviewProjectSettings } from "@/components/harden/dev-preview/project-settings";
import type { CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";
import { renderWithClient } from "./utils";

/**
 * The button under the dev preview's settings form follows what is stored and what the form
 * holds. Whatever it is called, commands are stored only from the confirmation dialog.
 */
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn() }),
);
vi.mock("sonner", () => ({ toast }));

const PROJECT = "p-storefront";
const project = { id: PROJECT } as Project;
const stored: DevPreviewConfig = {
  command: "pnpm dev",
  prepareCommand: "pnpm install --frozen-lockfile",
  portVars: ["PORT", "API_PORT"],
  urlFrom: "port",
  urlPattern: null,
  pmEnabled: true,
  confirmedAt: "2026-11-23T10:00:00.000Z",
  baseBranch: "main",
};
const view = (over: Partial<DevPreviewProject> = {}): DevPreviewProject => ({
  projectId: PROJECT,
  config: null,
  suggestion: null,
  recommended: null,
  baseBranch: "main",
  notice: null,
  remote: false,
  ...over,
});
const base = (over: Partial<DevPreviewState> = {}): DevPreviewState => ({
  key: devPreviewBaseKey(PROJECT),
  kind: "base",
  projectId: PROJECT,
  sessionId: null,
  status: "running",
  enabled: true,
  url: "http://localhost:43100/",
  ports: [43100],
  message: null,
  logTail: [],
  startedAt: null,
  configured: true,
  unavailable: null,
  remote: false,
  base: { branch: "main", commit: "0123456789", checkedAt: null, blocked: false },
  ...over,
});

function show(api: Partial<CodeDenClient["devPreview"]>) {
  const client = createMockClient();
  const confirmProject = vi.fn(async () => view({ config: stored }));
  const updateBase = vi.fn(async () => base({ status: "starting", url: null }));
  renderWithClient(<DevPreviewProjectSettings project={project} />, {
    ...client,
    devPreview: { ...client.devPreview, confirmProject, updateBase, ...api },
  });
  return { confirmProject, updateBase };
}
const field = (id: string) => screen.getByTestId(id) as HTMLInputElement;
const type = (id: string, value: string) => fireEvent.change(field(id), { target: { value } });
const button = () => screen.getByTestId("dev-preview-save") as HTMLButtonElement;
/** The stored settings are in the form. */
const loaded = () => waitFor(() => expect(field("dev-preview-command").value).toBe("pnpm dev"));

describe("nothing stored yet", () => {
  it("has nothing to confirm in a form nobody touched", async () => {
    show({ project: async () => view() });
    await screen.findByTestId("dev-preview-command");
    expect(button().textContent).toBe("Start preview…");
    expect(button().disabled).toBe(true);
    expect(screen.queryByTestId("dev-preview-start")).toBeNull();
    expect(screen.getByTestId("dev-preview-confirmed").textContent).toMatch(/Nothing runs until/);
  });

  it("a filled form gets a green Start preview… that always asks first", async () => {
    const { confirmProject, updateBase } = show({ project: async () => view() });
    await screen.findByTestId("dev-preview-command");
    type("dev-preview-command", "pnpm dev");
    expect(button().textContent).toBe("Start preview…");
    expect(button().disabled).toBe(false);
    expect(button().className).toContain("bg-status-done");

    // The press opens the dialog with the exact command and the branch. Nothing else happened.
    fireEvent.click(button());
    const dialog = await screen.findByTestId("dev-preview-confirm");
    expect(dialog.textContent).toContain("Run these commands on this computer?");
    expect(dialog.textContent).toContain("pnpm dev");
    expect(dialog.textContent).toContain("(main)");
    expect(confirmProject).not.toHaveBeenCalled();

    // Cancelled: nothing is stored, nothing is started, and the button is still there.
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("dev-preview-confirm")).toBeNull());
    expect(confirmProject).not.toHaveBeenCalled();
    expect(button().textContent).toBe("Start preview…");
    expect(button().disabled).toBe(false);

    fireEvent.click(button());
    fireEvent.click(await screen.findByTestId("dev-preview-confirm-run"));
    await waitFor(() => expect(confirmProject).toHaveBeenCalledTimes(1));
    expect(confirmProject).toHaveBeenCalledWith(PROJECT, {
      command: "pnpm dev",
      prepareCommand: null,
      portVars: ["PORT"],
      urlFrom: "port",
      urlPattern: null,
      pmEnabled: true,
    });
    // Storing them is what starts the PM thread's preview: the form asks for no second start.
    expect(updateBase).not.toHaveBeenCalled();
  });

  it("is a plain Save… when the PM thread's preview is switched off: nothing would start", async () => {
    const { confirmProject } = show({ project: async () => view() });
    await screen.findByTestId("dev-preview-command");
    type("dev-preview-command", "pnpm dev");
    fireEvent.click(screen.getByTestId("dev-preview-pm"));
    expect(button().textContent).toBe("Save…");
    expect(button().className).not.toContain("bg-status-done");
    fireEvent.click(button());
    expect((await screen.findByTestId("dev-preview-confirm")).textContent).toContain(
      "No preview starts for the PM thread.",
    );
    expect(confirmProject).not.toHaveBeenCalled();
  });

  it("says what is missing instead of looking dead when only part is filled in", async () => {
    show({ project: async () => view() });
    await screen.findByTestId("dev-preview-command");
    type("dev-preview-prepare", "pnpm install");
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    expect((await screen.findByRole("alert")).textContent).toBe("Enter the dev command.");
    expect(screen.queryByTestId("dev-preview-confirm")).toBeNull();
  });
});

describe("stored and unchanged", () => {
  it("while the PM thread's preview runs: no button to press, only what is so", async () => {
    show({ project: async () => view({ config: stored }), base: async () => base() });
    await loaded();
    expect((await screen.findByTestId("dev-preview-stored-note")).textContent).toBe(
      "The PM thread's preview is running.",
    );
    expect(screen.queryByTestId("dev-preview-save")).toBeNull();
    expect(screen.queryByTestId("dev-preview-start")).toBeNull();
    expect(screen.getByTestId("dev-preview-confirmed").textContent).toMatch(/^Confirmed /);
    expect(screen.getByTestId("dev-preview-remove")).toHaveProperty("disabled", false);
  });

  const waiting =
    "Automatic merges are on for this project, so this preview waits for you to start it each time the app starts.";
  it.each([
    [
      "after Stop all",
      "stopped",
      "Stopped with Stop all. Restart it when you want it back.",
      "Restart",
    ],
    ["with automatic merges, after the app started", "stopped", waiting, "Restart"],
    ["after a start that failed", "failed", "The prepare command exited with code 1.", "Restart"],
    ["before it ever started", "off", null, "Start preview"],
  ] as const)(
    "%s: starts the stored commands, as the strip's Restart does",
    async (_, status, message, label) => {
      const { confirmProject, updateBase } = show({
        project: async () => view({ config: stored }),
        base: async () => base({ status, message, url: null, ports: [] }),
      });
      await loaded();
      const start = (await screen.findByTestId("dev-preview-start")) as HTMLButtonElement;
      expect(start.textContent).toBe(label);
      expect(start.disabled).toBe(false);
      expect(start.className).toContain("bg-status-done");
      expect(screen.getByTestId("dev-preview-stored-note").textContent).toBe(
        message ?? "The PM thread's preview isn't running.",
      );
      expect(screen.queryByTestId("dev-preview-save")).toBeNull();

      fireEvent.click(start);
      await waitFor(() => expect(updateBase).toHaveBeenCalledWith(PROJECT));
      // The stored commands are the confirmed ones: nothing is asked and nothing is stored.
      expect(screen.queryByTestId("dev-preview-confirm")).toBeNull();
      expect(confirmProject).not.toHaveBeenCalled();
      expect((await screen.findByTestId("dev-preview-stored-note")).textContent).toBe(
        "The PM thread's preview is starting.",
      );
    },
  );

  it.each([
    [
      "the PM thread's preview is switched off",
      { ...stored, pmEnabled: false },
      base({ status: "off", enabled: false, url: null }),
      /switched off\. Switch on “On the PM thread”/,
    ],
    [
      "the project can't have one",
      stored,
      base({ status: "stopped", url: null, unavailable: "The project has no base branch set." }),
      /^The project has no base branch set\.$/,
    ],
  ] as const)("says why it can't be started from here when %s", async (_, config, state, why) => {
    show({ project: async () => view({ config }), base: async () => state });
    await loaded();
    expect((await screen.findByTestId("dev-preview-stored-note")).textContent).toMatch(why);
    expect(screen.queryByTestId("dev-preview-start")).toBeNull();
    expect(screen.queryByTestId("dev-preview-save")).toBeNull();
  });

  it("the base branch changed: Confirm again… asks for the same commands on the new branch", async () => {
    const { confirmProject, updateBase } = show({
      project: async () => view({ config: stored, baseBranch: "release" }),
      base: async () => base({ status: "stopped", url: null, message: "The base branch changed." }),
    });
    await loaded();
    expect(button().textContent).toBe("Confirm again…");
    expect(button().disabled).toBe(false);
    // Not startable without that: the stored commands were confirmed for another branch.
    expect(screen.queryByTestId("dev-preview-start")).toBeNull();
    fireEvent.click(button());
    expect((await screen.findByTestId("dev-preview-confirm")).textContent).toContain("(release)");
    expect(confirmProject).not.toHaveBeenCalled();
    expect(updateBase).not.toHaveBeenCalled();
  });
});

describe("stored and then edited", () => {
  it("Save changes… is enabled and asks, and undoing the edit takes it away again", async () => {
    const { confirmProject } = show({
      project: async () => view({ config: stored }),
      base: async () => base({ status: "stopped", url: null }),
    });
    await loaded();
    await screen.findByTestId("dev-preview-start");
    type("dev-preview-command", "pnpm dev --turbo");
    expect(button().textContent).toBe("Save changes…");
    expect(button().disabled).toBe(false);
    expect(button().className).not.toContain("bg-status-done");
    // What is in the form isn't what was confirmed, so it can't be started from here.
    expect(screen.queryByTestId("dev-preview-start")).toBeNull();
    fireEvent.click(button());
    expect((await screen.findByTestId("dev-preview-confirm")).textContent).toContain(
      "pnpm dev --turbo",
    );
    expect(confirmProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("dev-preview-confirm")).toBeNull());

    type("dev-preview-command", "pnpm dev");
    expect(screen.queryByTestId("dev-preview-save")).toBeNull();
    expect(screen.getByTestId("dev-preview-start")).toBeTruthy();
  });

  it("space that storing drops is no edit, and a real edit beside it is one", async () => {
    show({ project: async () => view({ config: stored }), base: async () => base() });
    await loaded();
    type("dev-preview-prepare", "pnpm install --frozen-lockfile ");
    type("dev-preview-command", "  pnpm dev");
    type("dev-preview-port-vars", "PORT,API_PORT ");
    expect(screen.queryByTestId("dev-preview-save")).toBeNull();
    type("dev-preview-port-vars", "PORT");
    expect(button().textContent).toBe("Save changes…");
    type("dev-preview-port-vars", "PORT, API_PORT");
    type("dev-preview-prepare", "pnpm  install --frozen-lockfile");
    expect(button().textContent).toBe("Save changes…");
  });
});

describe("formChanged", () => {
  const form = formOf(stored);
  it("compares the form as it would be stored", () => {
    expect(formChanged(form, stored)).toBe(false);
    expect(formChanged({ ...form, command: " pnpm dev\t" }, stored)).toBe(false);
    expect(formChanged({ ...form, portVars: "PORT API_PORT" }, stored)).toBe(false);
    // A pattern the link doesn't use isn't stored.
    expect(formChanged({ ...form, urlPattern: "Local: (\\S+)" }, stored)).toBe(false);
    expect(formChanged({ ...form, prepareCommand: "" }, stored)).toBe(true);
    expect(formChanged({ ...form, portVars: "API_PORT, PORT" }, stored)).toBe(true);
    expect(formChanged({ ...form, urlFrom: "output" }, stored)).toBe(true);
    expect(formChanged({ ...form, pmEnabled: false }, stored)).toBe(true);
    expect(formChanged({ ...form, command: "pnpm  dev" }, stored)).toBe(true);
  });

  it("an empty form, with or without spaces, holds nothing", () => {
    expect(formChanged(formOf(null), null)).toBe(false);
    expect(formChanged({ ...formOf(null), command: "  " }, null)).toBe(false);
    expect(formChanged({ ...formOf(null), command: "pnpm dev" }, null)).toBe(true);
  });
});
