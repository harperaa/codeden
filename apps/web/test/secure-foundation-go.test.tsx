import type { SecureFoundationLogin } from "@codeden/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CREATED_STAYS } from "@/components/harden/secure-foundation/consent";
import { ApiRequestError } from "@/lib/api/http";
import {
  connection,
  EMAIL,
  goButton,
  openDialog,
  statusOf,
  template,
  typeName,
  verified,
} from "./secure-foundation-fixtures";

/**
 * Go: one press verifies and creates; a check that doesn't hold opens the verification view on
 * it and nothing is asked to be created. All on a scripted client: no server, no CLI, no clone.
 */

const view = () => screen.findByTestId("secure-foundation-verify");
const ids = () =>
  [...screen.getByTestId("secure-foundation-verify").querySelectorAll("li[data-status]")].map(
    (li) => li.getAttribute("data-testid"),
  );
const remote = () =>
  Promise.reject(
    new ApiRequestError(
      403,
      "forbidden",
      "Sign-ins can only be checked and started on the computer running the app.",
    ),
  );

describe("Go with everything passing", () => {
  it("creates the project in one press, with every module and the commit just resolved", async () => {
    const { create, verify, connections, onClose } = openDialog();
    await typeName();
    fireEvent.click(goButton());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toEqual({
      name: "My Site",
      adminEmail: EMAIL,
      secrets: "doppler",
      shell: "all",
      modules: [],
      provider: "alpha",
      commit: template.commit,
    });
    // One pass of checks, made before the create, and no other screen on the way.
    expect(verify).toHaveBeenCalledTimes(1);
    expect(connections).toHaveBeenCalledWith(["convex", "doppler"]);
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0] as number,
    );
    expect(screen.queryByTestId("secure-foundation-verify")).toBeNull();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("says it is checking while it checks", async () => {
    let done: (v: ReturnType<typeof verified>) => void = () => {};
    const { create } = openDialog({ verify: () => new Promise((resolve) => (done = resolve)) });
    await typeName();
    fireEvent.click(goButton());
    await waitFor(() => expect(goButton().textContent).toBe("Checking…"));
    expect(goButton().disabled).toBe(true);
    done(verified());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it("creates nothing when the dialog is closed while it checks", async () => {
    let done: (v: ReturnType<typeof verified>) => void = () => {};
    const { create, close } = openDialog({
      verify: () => new Promise((resolve) => (done = resolve)),
    });
    await typeName();
    fireEvent.click(goButton());
    await waitFor(() => expect(goButton().textContent).toBe("Checking…"));
    close();
    done(verified());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(create).not.toHaveBeenCalled();
  });

  it("locks the answers while it checks, and never creates from answers that changed meanwhile", async () => {
    let done: (v: ReturnType<typeof verified>) => void = () => {};
    const { create } = openDialog({ verify: () => new Promise((resolve) => (done = resolve)) });
    await typeName();
    fireEvent.click(goButton());
    await waitFor(() => expect(goButton().textContent).toBe("Checking…"));
    const name = screen.getByLabelText("Project name") as HTMLInputElement;
    expect(name.closest("fieldset")?.disabled).toBe(true);
    // Should an edit get through all the same, the checks no longer count.
    fireEvent.change(name, { target: { value: "Other Site" } });
    done(verified());
    await view();
    expect(statusOf("check-answers")).toBe("needs_you");
    expect(screen.getByTestId("check-answers").textContent).toContain("Nothing was created");
    expect(create).not.toHaveBeenCalled();
    // Go again checks and creates what is on the form now.
    fireEvent.click(goButton());
    await waitFor(() => expect(goButton().textContent).toBe("Checking…"));
    done(verified());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({ name: "Other Site" });
  });

  it("uses the account's only Convex team without asking", async () => {
    const { create } = openDialog({
      connections: async (services) => ({
        connections: services.map((s) =>
          connection(
            s,
            s === "convex" ? { teams: [{ name: "Acme Labs", slug: "acme-labs" }] } : {},
          ),
        ),
      }),
    });
    await typeName();
    fireEvent.click(goButton());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({ convexTeam: "acme-labs" });
  });
});

describe("Go with a check that doesn't hold", () => {
  it("opens the verification view on a signed-out service, creates nothing, and goes on once it is fixed", async () => {
    let signedIn = false;
    const { create } = openDialog({
      connections: async (services) => ({
        connections: services.map((s) =>
          s === "convex" && !signedIn
            ? connection(s, { signedIn: false, message: "Not signed in to Convex." })
            : connection(s),
        ),
      }),
    });
    await typeName();
    fireEvent.click(goButton());
    await view();
    expect(statusOf("connection-convex")).toBe("needs_you");
    expect(screen.getByTestId("connection-convex").textContent).toContain(
      "Sign in to Convex with the button, then press Go.",
    );
    expect(screen.getByRole("button", { name: "Sign in to Convex" })).toBeTruthy();
    expect(screen.getByTestId("secure-foundation-stopped").textContent).toContain(
      "Go stopped before anything was created",
    );
    // What stopped it comes first; what passed follows.
    expect(ids()[0]).toBe("connection-convex");
    expect(statusOf("connection-doppler")).toBe("passed");
    expect(statusOf("check-folder")).toBe("passed");
    expect(create).not.toHaveBeenCalled();
    // Still signed out: Go from the view creates nothing either.
    fireEvent.click(goButton());
    await waitFor(() => expect(goButton().textContent).toBe("Go"));
    expect(create).not.toHaveBeenCalled();
    // Fixed: Go from the view goes on.
    signedIn = true;
    fireEvent.click(goButton());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it("marks what the server's checks refuse, with what to do about it", async () => {
    const { create } = openDialog({
      verify: async () =>
        verified({
          folder: {
            message: "/work/projects/my-site already exists.",
            fix: "Go back to the form and choose another project name, or move that folder away.",
          },
        }),
    });
    await typeName();
    fireEvent.click(goButton());
    await view();
    expect(statusOf("check-folder")).toBe("failed");
    expect(screen.getByTestId("check-folder").textContent).toContain("already exists");
    expect(screen.getByTestId("check-folder").textContent).toContain("choose another project name");
    expect(ids()[0]).toBe("check-folder");
    fireEvent.click(goButton());
    await waitFor(() => expect(goButton().textContent).toBe("Go"));
    expect(create).not.toHaveBeenCalled();
  });

  it("lands there with the server's reason when the create itself fails", async () => {
    const create = vi.fn(() =>
      Promise.reject(
        new ApiRequestError(
          502,
          "session_failed",
          "Secure Foundation stopped while starting the setup session: no runner. Nothing was left behind.",
        ),
      ),
    );
    const { onClose } = openDialog({ create });
    await typeName();
    fireEvent.click(goButton());
    await view();
    expect(statusOf("check-create")).toBe("failed");
    expect(screen.getByTestId("check-create").textContent).toContain("Nothing was left behind.");
    expect(ids()[0]).toBe("check-create");
    expect(onClose).not.toHaveBeenCalled();
    // A refused folder is marked on the folder's own check.
    create.mockImplementationOnce(() =>
      Promise.reject(new ApiRequestError(409, "destination_exists", "It already exists.")),
    );
    fireEvent.click(goButton());
    await waitFor(() => expect(statusOf("check-folder")).toBe("failed"));
    expect(screen.queryByTestId("check-create")).toBeNull();
  });

  it("shows a commit the person hasn't seen before installing it", async () => {
    const newer = { ...template, commit: "f".repeat(40), committedAt: "2026-02-01T08:00:00.000Z" };
    const { create } = openDialog({ verify: async () => verified({}, newer) });
    await typeName();
    fireEvent.click(goButton());
    await view();
    expect(statusOf("check-template")).toBe("needs_you");
    expect(screen.getByTestId("check-template").textContent).toContain(
      "is now at commit fffffff of 2026-02-01",
    );
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(goButton());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({ commit: newer.commit });
  });

  it("shows the first of several Convex teams before creating in it, and lets the person pick", async () => {
    const { create } = openDialog({
      connections: async (services) => ({
        connections: services.map((s) =>
          connection(
            s,
            s === "convex"
              ? {
                  teams: [
                    { name: "Acme Labs", slug: "acme-labs" },
                    { name: "Side Project", slug: "side-project" },
                  ],
                }
              : {},
          ),
        ),
      }),
    });
    await typeName();
    fireEvent.click(goButton());
    const select = (await screen.findByLabelText(/Convex team/)) as HTMLSelectElement;
    expect(statusOf("connection-convex")).toBe("needs_you");
    expect(screen.getByTestId("connection-convex").textContent).toContain(
      "This account has several teams.",
    );
    expect(select.value).toBe("acme-labs");
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "side-project" } });
    fireEvent.click(goButton());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({ convexTeam: "side-project" });
  });
});

describe("the verification view", () => {
  it("opened by hand runs the checks and shows them, the lists and nothing personal", async () => {
    const { create, verify } = openDialog();
    await typeName();
    fireEvent.click(screen.getByRole("button", { name: "Verify Settings" }));
    await waitFor(() => expect(ids()).toHaveLength(6));
    expect(verify).toHaveBeenCalledTimes(1);
    // In the order they are checked.
    expect(ids()).toEqual([
      "check-fields",
      "check-folder",
      "check-template",
      "check-provider",
      "connection-convex",
      "connection-doppler",
    ]);
    expect(screen.queryByTestId("secure-foundation-stopped")).toBeNull();
    const text = (await view()).textContent ?? "";
    expect(text).toContain("What happens when you press Go");
    expect(text).toContain("/work/projects/my-site as a new local git repository");
    expect(text).toContain("commit 0123456 of 2026-01-05");
    expect(text).toContain("Alpha at the Full permission level");
    expect(text).toContain("Content modules installed: blog, pricing.");
    for (const service of ["Clerk:", "Convex:", "Doppler:"]) expect(text).toContain(service);
    expect(text).toContain('a Doppler project named "my-site"');
    expect(text).toContain(CREATED_STAYS);
    // The email is not repeated on the page.
    expect(text).not.toContain(EMAIL);
    expect(create).not.toHaveBeenCalled();
    // Check again runs them again; Back keeps the answers.
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(goButton().textContent).toBe("Go"));
    fireEvent.click(screen.getByRole("button", { name: "Back to the form" }));
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("My Site");
  });

  it("asks only for the services the answers need", async () => {
    const { connections } = openDialog();
    await typeName();
    fireEvent.click(screen.getByLabelText(/\.env\.local/));
    fireEvent.click(screen.getByRole("button", { name: "Verify Settings" }));
    await screen.findByTestId("connection-convex");
    expect(connections).toHaveBeenCalledWith(["convex"]);
    expect(screen.queryByTestId("connection-doppler")).toBeNull();
  });

  it("names a missing tool's install command and never offers to install it", async () => {
    const { create } = openDialog({
      connections: async () => ({
        connections: [
          connection("convex"),
          connection("doppler", {
            cli: "missing",
            signedIn: null,
            message: "The doppler command isn't installed on this computer.",
            install: "brew install dopplerhq/cli/doppler",
          }),
        ],
      }),
    });
    await typeName();
    fireEvent.click(goButton());
    await view();
    expect(statusOf("connection-doppler")).toBe("needs_you");
    expect(screen.getByText("brew install dopplerhq/cli/doppler")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sign in to Doppler|Install/ })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("starts a login, shows its link and code to the person, and can cancel it", async () => {
    const waiting: SecureFoundationLogin = {
      id: "l1",
      service: "convex",
      status: "waiting",
      url: "https://auth.convex.dev/activate?user_code=WXYZ-1234",
      code: "WXYZ-1234",
      message: "Open the link to sign in to Convex.",
    };
    const cancelLogin = vi.fn(async () => ({
      ...waiting,
      status: "cancelled" as const,
      url: null,
      code: null,
      message: "The Convex sign-in was cancelled.",
    }));
    openDialog({
      connections: async (services) => ({
        connections: services.map((s) => connection(s, s === "convex" ? { signedIn: false } : {})),
      }),
      startLogin: async () => waiting,
      cancelLogin,
    });
    await typeName();
    fireEvent.click(goButton());
    fireEvent.click(await screen.findByRole("button", { name: "Sign in to Convex" }));
    const link = (await screen.findByRole("link", {
      name: /Open the Convex sign-in page/,
    })) as HTMLAnchorElement;
    expect(link.href).toBe(waiting.url);
    expect(screen.getByText("WXYZ-1234")).toBeTruthy();
    const row = screen.getByTestId("connection-convex");
    fireEvent.click(row.querySelector("button") as HTMLElement);
    await waitFor(() => expect(cancelLogin).toHaveBeenCalledWith("l1"));
    await screen.findByText("The Convex sign-in was cancelled.");
    expect(screen.queryByText("WXYZ-1234")).toBeNull();
  });
});

describe("on another device", () => {
  it("says plainly that sign-ins can't be checked there, and goes on only after that was shown", async () => {
    const { create } = openDialog({ connections: remote });
    await typeName();
    fireEvent.click(goButton());
    await view();
    expect(statusOf("check-signins")).toBe("needs_you");
    const text = screen.getByTestId("check-signins").textContent ?? "";
    expect(text).toContain("Sign-ins can only be checked on the computer running the app");
    expect(text).toContain("the setup session checks the sign-ins on the computer it runs on");
    expect(create).not.toHaveBeenCalled();
    // As before, the person can go on once they have read it.
    fireEvent.click(goButton());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it("never lets a ticked deploy through", async () => {
    const { create } = openDialog({ connections: remote });
    await typeName();
    fireEvent.click(screen.getByLabelText(/Create a GitHub repository and deploy to Vercel/));
    fireEvent.click(goButton());
    await view();
    expect(screen.getByTestId("check-signins").textContent).toContain("untick Deploy");
    fireEvent.click(goButton());
    await waitFor(() => expect(goButton().textContent).toBe("Go"));
    expect(create).not.toHaveBeenCalled();
  });
});

describe("with the deploy option", () => {
  const github = connection("github", {
    account: "demo-person",
    owners: ["demo-person", "acme-org"],
  });
  const vercel = connection("vercel", {
    account: "demo-person",
    scopes: [
      { slug: "acme-team", name: "Acme Team" },
      { slug: "side-team", name: "Side Team" },
    ],
  });
  const withDeploy = async (patch: Parameters<typeof connection>[1][] = [{}, {}]) => {
    const made = openDialog({
      connections: async () => ({
        connections: [
          connection("convex"),
          connection("doppler"),
          { ...github, ...patch[0] },
          { ...vercel, ...patch[1] },
        ],
      }),
    });
    await typeName();
    fireEvent.click(screen.getByLabelText(/Create a GitHub repository and deploy to Vercel/));
    return made;
  };

  it("is off until ticked, and shows where the site goes before anything is created", async () => {
    const { create } = await withDeploy();
    fireEvent.click(goButton());
    await screen.findByTestId("deploy-fields");
    expect(statusOf("check-deploy")).toBe("needs_you");
    expect(screen.getByTestId("check-deploy").textContent).toContain("demo-person/my-site");
    expect((screen.getByLabelText("Repository name") as HTMLInputElement).value).toBe("my-site");
    expect(screen.getByTestId("deploy-fields").textContent).toContain("private");
    expect(screen.getByTestId("secure-foundation-creates").textContent).toContain(
      "a private repository demo-person/my-site",
    );
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(goButton());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      deploy: { owner: "demo-person", repository: "my-site", vercelScope: "acme-team" },
    });
  });

  it("preselects the last deploy's owner, and says what an organisation's repository gets", async () => {
    const { create } = await withDeploy([{ lastOwner: "acme-org" }, {}]);
    fireEvent.click(goButton());
    const fields = await screen.findByTestId("deploy-fields");
    const owner = within(fields).getByLabelText("Repository owner") as HTMLSelectElement;
    expect(owner.value).toBe("acme-org");
    expect(owner.textContent).toContain("demo-person (your account)");
    expect(owner.textContent).toContain("acme-org (used last time)");
    expect(screen.getByTestId("deploy-owner-secrets").textContent).toContain(
      "A repository in an organisation gets the secrets that organisation shares with its repositories",
    );
    expect(screen.getByTestId("check-deploy").textContent).toContain("acme-org/my-site");
    fireEvent.click(goButton());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({ deploy: { owner: "acme-org" } });
  });

  it("holds Go on a name that can't be a repository, a missing permission and no Vercel team", async () => {
    const { create } = await withDeploy([{ missingScopes: ["workflow"] }, { scopes: [] }]);
    fireEvent.click(goButton());
    await screen.findByRole("button", { name: "Add the workflow permission" });
    expect(statusOf("connection-github")).toBe("needs_you");
    await screen.findByText(/Vercel listed no team/);
    expect(statusOf("check-deploy")).toBe("needs_you");
    fireEvent.click(goButton());
    await waitFor(() => expect(goButton().textContent).toBe("Go"));
    expect(create).not.toHaveBeenCalled();
  });
});
