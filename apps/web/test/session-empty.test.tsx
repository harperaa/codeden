import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockClient } from "@/lib/api/mock";
import { NewSessionPage } from "@/routes/new-session";
import { SessionPage } from "@/routes/session";
import { renderWithClient } from "./utils";

/**
 * Empty (non-forked) session transcript greets with "Hi" (#32); New session draft unchanged.
 */
describe("empty session transcript greeting (#32)", () => {
  it("shows Hi as the empty session title and keeps the no-messages hint", async () => {
    // s-pm-billing has no transcript fixture, so ThreadView renders the empty slot.
    renderWithClient(<SessionPage sessionId="s-pm-billing" />, createMockClient(), {
      withRouter: true,
    });
    await waitFor(() => expect(screen.getByText("Hi")).toBeTruthy());
    expect(screen.getByText(/No messages yet/)).toBeTruthy();
    expect(screen.getByText(/Describe the task/)).toBeTruthy();
  });

  it("leaves the New session draft empty title as New session", async () => {
    renderWithClient(<NewSessionPage projectId="p-storefront" />, createMockClient(), {
      withRouter: true,
    });
    await screen.findByTestId("new-session");
    // Header and empty-state title both say "New session".
    expect(screen.getAllByText("New session").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Hi")).toBeNull();
  });
});
