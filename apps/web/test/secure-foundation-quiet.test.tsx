import {
  type Project,
  SECURE_FOUNDATION_WORK_KEY,
  type Session,
  type Snapshot,
} from "@codeden/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SecureFoundationStatus } from "@/components/harden/secure-foundation/status";
import type { CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";
import { renderWithClient } from "./utils";

/** The project page's Secure Foundation card while the project is quiet, and after. */

/**
 * The mock's first project as one Secure Foundation set up, in `mode`. Without `setup` the
 * snapshot has no setup session (it was archived long ago) and `serverSays` is the server's answer.
 */
async function clientFor(
  mode: Project["autonomyMode"],
  setup = true,
  serverSays = false,
): Promise<CodeDenClient> {
  const client = createMockClient();
  const snapshot = await client.getSnapshot();
  const project = { ...(snapshot.projects[0] as Project), autonomyMode: mode };
  const session = {
    ...(snapshot.sessions[0] as Session),
    id: "s-setup",
    projectId: project.id,
    workKey: setup ? SECURE_FOUNDATION_WORK_KEY : "request:hello",
    status: "running",
    progress: null,
    archivedAt: null,
  } as Session;
  const world: Snapshot = { ...snapshot, projects: [project], sessions: [session] };
  return {
    ...client,
    getSnapshot: async () => world,
    secureFoundation: { ...client.secureFoundation, quiet: async () => ({ quiet: serverSays }) },
  };
}

async function card(client: CodeDenClient): Promise<HTMLElement> {
  const snapshot = await client.getSnapshot();
  renderWithClient(
    <SecureFoundationStatus projectId={(snapshot.projects[0] as Project).id} />,
    client,
    { withRouter: true },
  );
  return screen.findByTestId("secure-foundation-status");
}

describe("the Secure Foundation card of a quiet project", () => {
  it("says automatic work is off, what that means and how to turn it on", async () => {
    const text = within(await card(await clientFor("manual"))).getByTestId(
      "secure-foundation-quiet",
    ).textContent;
    expect(text).toContain("Automatic work is off.");
    expect(text).toContain("nothing starts in it by itself");
    expect(text).toContain("don't wake its project manager");
    expect(text).toContain("change the project's autonomy mode from Manual to Assisted");
  });

  it("opens the autonomy dialog on Assisted", async () => {
    await card(await clientFor("manual"));
    fireEvent.click(screen.getByTestId("secure-foundation-turn-on"));
    const modes = await screen.findByTestId("autonomy-modes");
    const pressed = within(modes)
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.textContent).toContain("Assisted");
  });

  it("says nothing of it once the person chose another mode", async () => {
    const status = await card(await clientFor("assisted"));
    expect(within(status).queryByTestId("secure-foundation-quiet")).toBeNull();
  });

  it("keeps saying it when the setup session has left the snapshot", async () => {
    const status = await card(await clientFor("manual", false, true));
    expect(within(status).getByTestId("secure-foundation-quiet").textContent).toContain(
      "Automatic work is off.",
    );
    fireEvent.click(screen.getByTestId("secure-foundation-turn-on"));
    expect(await screen.findByTestId("autonomy-modes")).toBeTruthy();
  });

  it("shows no card for a Manual project the server doesn't know as one", async () => {
    const client = await clientFor("manual", false, false);
    const asked = vi.spyOn(client.secureFoundation, "quiet");
    const snapshot = await client.getSnapshot();
    renderWithClient(
      <SecureFoundationStatus projectId={(snapshot.projects[0] as Project).id} />,
      client,
      { withRouter: true },
    );
    await waitFor(() => expect(asked).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("secure-foundation-status")).toBeNull());
  });
});
