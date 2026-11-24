import {
  SECURE_FOUNDATION_TOOLS,
  type SecureFoundationRequirements,
  type SecureFoundationToolCheck,
} from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSecureFoundationAccounts } from "@/components/harden/secure-foundation/account-store";
import { platform } from "@/lib/platform";
import { SecureFoundationSetupPage } from "@/routes/secure-foundation-setup";
import { clientWith, openDialog } from "./secure-foundation-fixtures";
import { renderWithClient } from "./utils";

/** The requirements page: in front of the form when something is missing, never otherwise. */

type Patch = Partial<Record<SecureFoundationToolCheck["id"], Partial<SecureFoundationToolCheck>>>;
const checked = (patch: Patch = {}): SecureFoundationRequirements => ({
  checkedAt: "2026-01-05T10:00:00.000Z",
  platform: "darwin",
  tools: SECURE_FOUNDATION_TOOLS.map((t) => ({
    id: t.id,
    state: "ok" as const,
    found: true,
    version: "1.2.3",
    signedIn: t.service ? true : null,
    message: t.service ? "Signed in on this computer." : "Installed.",
    ...patch[t.id],
  })),
});
const MISSING_GIT: Patch = {
  git: { state: "missing", found: false, version: null, message: "git isn't installed." },
};
const row = (id: string) => document.querySelector(`[data-requirement="${id}"]`) as HTMLElement;

afterEach(() => {
  vi.restoreAllMocks();
  useSecureFoundationAccounts.setState({ confirmed: {} });
});

describe("opening Secure Foundation", () => {
  it("goes straight to the form when everything is there", async () => {
    const requirements = vi.fn(async () => checked());
    openDialog({ requirements });
    await waitFor(() => expect(requirements).toHaveBeenCalled());
    await screen.findByLabelText("Project name");
    expect(screen.queryByTestId("secure-foundation-requirements")).toBeNull();
  });

  it("shows the requirements page when a tool is missing, and leaves it once a check finds it", async () => {
    const requirements = vi
      .fn<() => Promise<SecureFoundationRequirements>>()
      .mockResolvedValueOnce(checked(MISSING_GIT))
      .mockResolvedValue(checked());
    openDialog({ requirements });
    await screen.findByTestId("secure-foundation-requirements");
    expect(screen.queryByLabelText("Project name")).toBeNull();
    expect(row("git").getAttribute("data-state")).toBe("missing");
    expect(row("git").textContent).toContain("xcode-select --install");
    expect(row("node").getAttribute("data-state")).toBe("ok");
    expect(screen.getByTestId("requirements-continue").textContent).toBe("Continue anyway");

    fireEvent.click(screen.getByTestId("requirements-check-again"));
    await screen.findByLabelText("Project name");
    expect(screen.queryByTestId("secure-foundation-requirements")).toBeNull();
  });

  it("lets the person go on anyway, and doesn't come back by itself", async () => {
    openDialog({ requirements: async () => checked(MISSING_GIT) });
    fireEvent.click(await screen.findByTestId("requirements-continue"));
    await screen.findByLabelText("Project name");
    // Opened again by hand: the same page, to look at.
    fireEvent.click(screen.getByTestId("secure-foundation-requirements-link"));
    expect(screen.getByTestId("requirements-continue").textContent).toBe("Back to the form");
  });

  it("offers Convex's sign-in and its sign-up page when Convex is signed out", async () => {
    const opened = vi.spyOn(platform, "openExternal").mockImplementation(() => {});
    const startLogin = vi.fn(async () => ({
      id: "l1",
      service: "convex" as const,
      status: "waiting" as const,
      url: "https://dashboard.convex.dev/device",
      code: "ABCD-EFGH",
      message: "Open the link to sign in to Convex.",
    }));
    openDialog({
      requirements: async () =>
        checked({
          convex: { state: "needs_sign_in", signedIn: false, message: "Not signed in." },
        }),
      startLogin,
    });
    await screen.findByTestId("secure-foundation-requirements");
    const convex = row("account-convex");
    expect(convex.getAttribute("data-state")).toBe("missing");
    expect(convex.textContent).toContain("Creating an account is all you need to do there");
    fireEvent.click(screen.getByTestId("create-account-convex"));
    expect(opened).toHaveBeenCalledWith("https://dashboard.convex.dev");
    fireEvent.click(convex.querySelector("button:last-of-type") as HTMLElement);
    await waitFor(() => expect(startLogin).toHaveBeenCalledWith("convex"));
    await waitFor(() => expect(convex.textContent).toContain("ABCD-EFGH"));
  });

  it("is not shown for a tool only an option needs, for Clerk, or when the check can't run", async () => {
    openDialog({
      requirements: async () =>
        checked({
          gh: { state: "missing", found: false },
          doppler: { state: "needs_sign_in" },
          clerk: { state: "needs_sign_in", signedIn: false },
        }),
    });
    await screen.findByLabelText("Project name");
    expect(screen.queryByTestId("secure-foundation-requirements")).toBeNull();
  });

  it("doesn't hold the form back when the check itself fails (another device)", async () => {
    const requirements = vi.fn(async () => {
      throw new Error("Only on the computer running the app.");
    });
    openDialog({ requirements });
    await waitFor(() => expect(requirements).toHaveBeenCalled());
    await screen.findByLabelText("Project name");
    expect(screen.queryByTestId("secure-foundation-requirements")).toBeNull();
  });
});

describe("Secure Foundation Setup, from Settings", () => {
  it("lists every row with its state when everything is there, Clerk included", async () => {
    renderWithClient(
      <SecureFoundationSetupPage />,
      clientWith({ requirements: async () => checked() }),
      { withRouter: true },
    );
    await waitFor(() => expect(row("node")?.getAttribute("data-state")).toBe("ok"));
    expect(row("node").textContent).toContain("Version 1.2.3");
    for (const id of ["npm", "git", "doppler", "gh"]) {
      expect(row(id).getAttribute("data-state")).toBe("ok");
    }
    for (const id of ["clerk", "convex", "doppler", "github", "vercel"]) {
      expect(row(`account-${id}`).getAttribute("data-state")).toBe("ok");
    }
    expect(row("gh").textContent).toContain("only for the Deploy option");
    // Signed in for real: nothing to press, and no manual mark.
    expect(row("account-clerk").textContent).toContain("Signed in on this computer");
    expect(row("account-clerk").querySelector("button")).toBeNull();
  });

  it("starts Clerk's own sign-in from 'Create or Sign-in' when Clerk is signed out", async () => {
    const startLogin = vi.fn(async () => ({
      id: "l1",
      service: "clerk" as const,
      status: "waiting" as const,
      url: "https://clerk.clerk.com/oauth/authorize?state=xyz",
      code: null,
      message: "Open the link to sign in to Clerk.",
    }));
    renderWithClient(
      <SecureFoundationSetupPage />,
      clientWith({
        requirements: async () => checked({ clerk: { state: "needs_sign_in", signedIn: false } }),
        startLogin,
      }),
      { withRouter: true },
    );
    const clerk = () => row("account-clerk");
    // Not a failure: the setup doesn't depend on it.
    await waitFor(() => expect(clerk()?.getAttribute("data-state")).toBe("info"));
    expect(clerk().textContent).toContain(
      "Sign in so your Clerk account is ready to claim your app after the install.",
    );
    const button = screen.getByTestId("create-account-clerk");
    expect(button.textContent?.trim()).toBe("Create or Sign-in");
    fireEvent.click(button);
    await waitFor(() => expect(startLogin).toHaveBeenCalledWith("clerk"));
    await waitFor(() => expect(clerk().textContent).toContain("Open the Clerk sign-in page"));
  });

  it("opens Clerk's page instead when the sign-in can't be started here (no npx)", async () => {
    const opened = vi.spyOn(platform, "openExternal").mockImplementation(() => {});
    const startLogin = vi.fn();
    renderWithClient(
      <SecureFoundationSetupPage />,
      clientWith({
        requirements: async () => checked({ clerk: { state: "missing", found: false } }),
        startLogin,
      }),
      { withRouter: true },
    );
    await waitFor(() => expect(row("account-clerk")?.getAttribute("data-state")).toBe("info"));
    fireEvent.click(screen.getByTestId("create-account-clerk"));
    expect(opened).toHaveBeenCalledWith("https://dashboard.clerk.com/sign-in");
    expect(startLogin).not.toHaveBeenCalled();
  });

  it("lets the person say they have a Clerk account, keeps that in this browser, and undoes it", async () => {
    const page = () =>
      renderWithClient(
        <SecureFoundationSetupPage />,
        clientWith({
          requirements: async () =>
            checked({ clerk: { state: "unknown", found: true, signedIn: null } }),
        }),
        { withRouter: true },
      );
    const first = page();
    const clerk = () => row("account-clerk");
    // Couldn't be checked (a locked keychain, say): not a failure, and not stuck.
    await waitFor(() => expect(clerk()?.getAttribute("data-state")).toBe("info"));
    expect(clerk().textContent).toContain("couldn't be checked from this computer");
    expect(clerk().textContent).toContain("Having an account is all that's needed");

    fireEvent.click(screen.getByTestId("have-account-clerk"));
    expect(clerk().getAttribute("data-state")).toBe("ok");
    expect(clerk().textContent).toContain("You said you have a Clerk account");
    expect(clerk().textContent).toContain("claim your app after the install");
    expect(screen.queryByTestId("have-account-clerk")).toBeNull();
    // Only the yes is kept, in this browser.
    const kept = localStorage.getItem("codeharden.secure-foundation-accounts") ?? "";
    expect(JSON.parse(kept).state).toEqual({ confirmed: { clerk: true } });

    // Opened again later: still marked.
    first.unmount();
    page();
    await waitFor(() => expect(clerk()?.getAttribute("data-state")).toBe("ok"));

    fireEvent.click(screen.getByTestId("undo-account-clerk"));
    expect(clerk().getAttribute("data-state")).toBe("info");
    expect(screen.getByTestId("have-account-clerk")).toBeTruthy();
  });
});
