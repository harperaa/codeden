import { HARDEN_PRODUCT_NAME, type UpdateStatus } from "@codeden/contracts";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateModeHelp } from "@/components/settings/update-mode";
import { UpdateBanner } from "@/components/shell/update-banner";
import { createMockClient } from "@/lib/api/mock";
import { useHandoverStore } from "@/lib/updates";
import { renderWithClient } from "./utils";

/**
 * The update texts name the product being updated (CodeHarden), never upstream: the banner in
 * each of its states, "What's new" and the help of the Updates setting.
 */
const NEXT = "2026.1124.900";
const base: UpdateStatus = {
  current: "2026.1123.917",
  latest: NEXT,
  updateAvailable: true,
  enabled: true,
  mode: "notify",
  checkedAt: "2026-11-23T10:00:00.000Z",
  error: null,
  command: "npm i -g codeharden@latest",
  source: "packaged",
  state: "idle",
  target: null,
  progress: null,
  installError: null,
  canRestart: true,
  restartCommand: "codeharden",
  installed: [],
  rollbackTo: null,
  canRollback: false,
  warning: null,
};

async function banner(over: Partial<UpdateStatus> = {}): Promise<string> {
  const client = createMockClient();
  vi.spyOn(client, "getUpdates").mockResolvedValue({ ...base, ...over });
  // Never answers as the new version, so a restarting banner stays as it is.
  vi.spyOn(client.updates, "serverVersion").mockResolvedValue(null);
  renderWithClient(<UpdateBanner />, client);
  const text = (await screen.findByTestId("update-banner")).textContent ?? "";
  expect(text).not.toContain("CodeDen");
  return text;
}

beforeEach(() => {
  localStorage.clear();
  useHandoverStore.getState().set("idle", null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useHandoverStore.getState().set("idle", null);
});

describe("update texts name the product", () => {
  it("is CodeHarden here", () => {
    expect(HARDEN_PRODUCT_NAME).toBe("CodeHarden");
  });

  it("offers the new version by the product's name", async () => {
    expect(await banner()).toContain(
      `CodeHarden ${NEXT} is available. You're on 2026.1123.917. Updating takes a moment and restarts CodeHarden.`,
    );
  });

  it("tells a source build that is behind to pull and rebuild, naming npm's version", async () => {
    const text = await banner({ source: "source", current: "0.7.7", canRestart: false });
    expect(text).toContain(
      `CodeHarden ${NEXT} is available. You're running from source: pull and rebuild to update.`,
    );
    expect(screen.queryByRole("button", { name: "Update now" })).toBeNull();
  });

  it("shows nothing for a source build that is not behind", async () => {
    const client = createMockClient();
    const status = { ...base, source: "source" as const, updateAvailable: false };
    const getUpdates = vi.spyOn(client, "getUpdates").mockResolvedValue(status);
    renderWithClient(<UpdateBanner />, client);
    await vi.waitFor(() => expect(getUpdates).toHaveBeenCalled());
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  it("names it while installing, when installed and while restarting", async () => {
    expect(await banner({ state: "installing", target: NEXT, progress: "Downloading" })).toContain(
      `Installing CodeHarden ${NEXT}...`,
    );
    cleanup();
    expect(await banner({ state: "installed", target: NEXT })).toContain(
      `CodeHarden ${NEXT} is installed and starts the next time you open CodeHarden.`,
    );
    cleanup();
    expect(await banner({ state: "installed", target: NEXT, canRestart: false })).toContain(
      "Update installed. Restart CodeHarden to finish: codeharden",
    );
    cleanup();
    expect(await banner({ state: "restarting", target: NEXT })).toContain(
      `Updating CodeHarden to ${NEXT}... restarting.`,
    );
  });

  it("names it when the restart has to be done by hand", async () => {
    useHandoverStore.getState().set("timeout", NEXT);
    expect(await banner()).toContain("Update installed. Restart CodeHarden to finish: codeharden");
  });

  it("titles What's new with the product's name", async () => {
    await banner();
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    const dialog = await screen.findByTestId("whats-new");
    expect(dialog.textContent).toContain(`What's new in CodeHarden ${NEXT}`);
    expect(dialog.textContent).toContain("Release notes from the CodeHarden repository.");
    expect(dialog.textContent).not.toContain("CodeDen");
  });

  it("names it in the help of the Updates setting", () => {
    expect(updateModeHelp("auto", "packaged")).toBe(
      "Also downloads new versions in the background; they start the next time you open CodeHarden.",
    );
    expect(updateModeHelp("auto", "desktop")).toBe(
      "Also downloads new versions in the background; they install when you quit CodeHarden.",
    );
  });
});
