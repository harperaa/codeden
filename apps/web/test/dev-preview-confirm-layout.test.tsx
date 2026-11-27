import type { DevPreviewSettings } from "@codeden/contracts";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DevPreviewConfirmDialog } from "@/components/harden/dev-preview/confirm-dialog";

/**
 * The confirmation dialog in a short window: its height is limited to the window's, what it
 * shows scrolls inside it, and the footer with the two buttons is outside the scrolling part,
 * so it can't be pushed below the visible area. jsdom has no layout, so this reads the
 * structure and the classes that make it so.
 */
const settings: DevPreviewSettings = {
  command: "doppler run --project my-site --config dev -- npm run dev",
  prepareCommand: `npm ci && ${"npx convex codegen && ".repeat(20)}true`,
  portVars: ["PORT"],
  urlFrom: "port",
  urlPattern: null,
  pmEnabled: false,
};

const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);
const limitsHeight = (el: Element) => classes(el).some((c) => c.startsWith("max-h-"));
const scrolls = (el: Element) =>
  classes(el).some((c) => c === "overflow-y-auto" || c === "overflow-auto");

/** The nearest element between `el` and the dialog that scrolls its contents, if any. */
function scrollingAncestor(el: Element, dialog: Element): Element | null {
  for (let at = el.parentElement; at && at !== dialog; at = at.parentElement) {
    if (scrolls(at)) return at;
  }
  return null;
}

describe("the dev preview confirmation dialog in a short window", () => {
  function open() {
    render(
      <DevPreviewConfirmDialog
        asking={settings}
        baseBranch="main"
        saving={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      >
        <div data-testid="notes">Before the preview works for this project: …</div>
      </DevPreviewConfirmDialog>,
    );
    return screen.getByTestId("dev-preview-confirm");
  }

  it("limits the dialog to the window's height", () => {
    expect(limitsHeight(open())).toBe(true);
  });

  it("scrolls the commands and the notes, with the footer outside the scrolling part", () => {
    const dialog = open();
    const command = within(dialog).getByText(settings.command);
    const notes = within(dialog).getByTestId("notes");
    const area = scrollingAncestor(command, dialog);
    expect(area).not.toBeNull();
    expect(scrollingAncestor(notes, dialog)).toBe(area);

    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const allow = within(dialog).getByRole("button", { name: "Save and allow" });
    expect(area?.contains(cancel)).toBe(false);
    expect(area?.contains(allow)).toBe(false);
  });
});
