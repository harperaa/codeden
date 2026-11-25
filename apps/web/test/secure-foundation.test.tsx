import {
  type SecureFoundationSecrets,
  secureFoundationCreates,
  secureFoundationCreatesLine,
} from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  consentStatements,
  consentSummary,
  createsOf,
  projectPath,
} from "@/components/harden/secure-foundation/consent";
import { type FormAnswers, FormStep } from "@/components/harden/secure-foundation/form-step";
import { SecureFoundationSlot } from "@/components/harden/secure-foundation/slot";
import { createMockClient } from "@/lib/api/mock";
import { blank, clientWith, goButton, options, template } from "./secure-foundation-fixtures";
import { renderWithClient } from "./utils";

/** The Secure Foundation option, its one form and what the form says pressing Go will do. */

describe("the option in the add-project dialog", () => {
  it("is hidden in a build without a template", async () => {
    const asked = vi.fn(async () => ({
      ...options,
      enabled: false,
      template: null,
      providers: [],
    }));
    renderWithClient(<SecureFoundationSlot />, clientWith({ options: asked }));
    await waitFor(() => expect(asked).toHaveBeenCalled());
    expect(screen.queryByTestId("secure-foundation-option")).toBeNull();
  });

  it("shows the card with the owner's copy when the build has one", async () => {
    renderWithClient(<SecureFoundationSlot />, clientWith({ options: async () => options }));
    const card = await screen.findByTestId("secure-foundation-option");
    expect(card.textContent).toContain("Secure Foundation");
    expect(card.textContent).toContain(
      "Hardened Nextjs, Clerk Billing, Convex, Doppler, Vercel stack.",
    );
    expect(card.textContent).not.toContain("Needs a signed-in agent provider");
  });

  it("explains itself when no signed-in provider can run the install", async () => {
    renderWithClient(
      <SecureFoundationSlot />,
      clientWith({ options: async () => ({ ...options, providers: [] }) }),
    );
    const card = await screen.findByTestId("secure-foundation-option");
    expect(card.textContent).toContain("Needs a signed-in agent provider");
  });
});

function Form({
  start = blank,
  onGo = () => {},
  onVerify = () => {},
}: {
  start?: FormAnswers;
  onGo?: () => void;
  onVerify?: () => void;
}) {
  const [answers, setAnswers] = useState(start);
  return (
    <FormStep
      options={options}
      template={template}
      templateError={null}
      onRetryTemplate={() => {}}
      answers={answers}
      onChange={setAnswers}
      busy={null}
      onGo={onGo}
      onVerify={onVerify}
      onCancel={() => {}}
    />
  );
}

describe("the form", () => {
  it("has Go as soon as the name and the email are valid, with All modules preselected", () => {
    const onGo = vi.fn();
    renderWithClient(<Form onGo={onGo} />, createMockClient());
    expect(goButton().disabled).toBe(true);
    expect((screen.getByLabelText(/Doppler/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/All modules/) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "My Site" } });
    expect(screen.getByTestId("secure-foundation-path").textContent).toContain(
      "/work/projects/my-site",
    );
    expect(goButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Admin email"), {
      target: { value: "person@site.test" },
    });
    expect(goButton().disabled).toBe(false);
    expect(goButton().textContent).toBe("Go");
    fireEvent.click(goButton());
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it("makes Go green from the design system's status colour, never a fixed one", () => {
    renderWithClient(<Form />, createMockClient());
    const classes = goButton().className.split(" ");
    expect(classes).toContain("bg-status-done");
    // The label is the theme's dark text colour in both themes: white falls short on this green.
    expect(classes).toContain("text-foreground");
    expect(classes).toContain("dark:text-background");
    expect(goButton().className).not.toMatch(/#[0-9a-f]{3,8}|rgb|oklch|emerald|green-/i);
  });

  it("offers Verify Settings whatever the fields hold, and keeps Advanced closed", () => {
    const onVerify = vi.fn();
    renderWithClient(<Form onVerify={onVerify} />, createMockClient());
    expect((screen.getByTestId("sf-advanced") as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByTestId("sf-advanced").textContent).toContain("Deploy off · runs on Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Verify Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(onVerify).toHaveBeenCalledTimes(2);
  });

  it("refuses a name that is a path and an address the install refuses", () => {
    renderWithClient(
      <Form start={{ ...blank, name: "../x", adminEmail: "admin@example.com" }} />,
      createMockClient(),
    );
    expect(goButton().disabled).toBe(true);
    expect(screen.getByTestId("secure-foundation-path").textContent).toContain("Use letters");
    expect(screen.getByText(/the install refuses placeholders/)).toBeTruthy();
  });

  it("lists the template's own modules under Pick, and says how each provider runs the install", () => {
    renderWithClient(<Form />, createMockClient());
    expect(screen.queryByText("A pricing page")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Pick/));
    expect(screen.getByText("A pricing page")).toBeTruthy();
    expect(screen.getByText(/runs the template's \/install command/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Runs on"), { target: { value: "beta" } });
    expect(screen.getByText(/reads the template's install instructions/)).toBeTruthy();
  });

  it("shows the commit that will be installed", () => {
    renderWithClient(<Form />, createMockClient());
    expect(screen.getByTestId("secure-foundation-template").textContent).toContain(
      "acme/starter, branch main, at commit 0123456 of 2026-01-05",
    );
  });
});

describe("the lines above the buttons", () => {
  const consent = () => screen.getByTestId("secure-foundation-consent").textContent ?? "";

  it("are always there and say what is created, that it runs unattended and what the URL is", () => {
    renderWithClient(<Form />, createMockClient());
    expect(consent()).toContain(
      "Creates a Clerk app, a Convex project and a Doppler project in your accounts.",
    );
    expect(consent()).toContain(
      "The setup session runs commands inside the new project without asking for each one (Full permission level).",
    );
    expect(consent()).toContain(
      "The app's URL only works while the setup session's processes are running.",
    );
    expect(consent()).toContain(
      "The new project starts with automatic work off (Manual mode): nothing else starts in it until you turn that on.",
    );
    // They follow the answers: without Doppler nothing is said to be created there.
    fireEvent.click(screen.getByLabelText(/\.env\.local/));
    expect(consent()).toContain("Creates a Clerk app and a Convex project in your accounts.");
    expect(consent()).not.toContain("Doppler");
  });

  it("name the repository and the site as soon as Deploy is ticked", () => {
    renderWithClient(<Form />, createMockClient());
    fireEvent.click(screen.getByLabelText(/Create a GitHub repository and deploy to Vercel/));
    expect(consent()).toContain(
      "Creates a Clerk app, a Convex project, a Doppler project, a private GitHub repository and a Vercel project with a public site in your accounts.",
    );
    expect(consent()).toContain("the deployed one stays up");
  });

  it.each([
    ["doppler", false],
    ["doppler", true],
    ["env_local", false],
    ["env_local", true],
  ] as Array<[SecureFoundationSecrets, boolean]>)(
    "name exactly what the setup session is held to (%s, deploy %s)",
    (secrets, deploy) => {
      const answers = {
        ...blank,
        name: "My Site",
        secrets,
        deploy,
        deployOwner: "acme-org",
        deployScope: "acme-team",
      };
      // The list the server gives the session's brief, from the request's own fields.
      const held = secureFoundationCreates({
        name: "My Site",
        secrets,
        deploy: deploy
          ? { owner: "acme-org", repository: "my-site", vercelScope: "acme-team" }
          : undefined,
      });
      expect(createsOf(answers)).toEqual(held);
      expect(consentSummary(answers, "full")[0]).toBe(secureFoundationCreatesLine(held));
      for (const created of held) {
        expect(consentSummary(answers, "full")[0]).toContain(created.short);
      }
      // A deploy whose names aren't chosen yet is still named.
      const early = { ...answers, deployOwner: undefined, deployScope: undefined };
      expect(consentSummary(early, "full")[0]).toBe(secureFoundationCreatesLine(held));
    },
  );
});

describe("what the verification view says will happen", () => {
  const input = {
    ...options,
    name: "My Site",
    secrets: "doppler" as const,
    modules: [] as string[],
    provider: options.providers[0] as (typeof options.providers)[number],
    template,
  };

  it("says where, from which commit, what runs unattended and what the URL is", () => {
    const text = consentStatements(input).join("\n");
    expect(projectPath(input)).toBe("/work/projects/my-site");
    expect(text).toContain("/work/projects/my-site as a new local git repository");
    expect(text).toContain("no remote, no link back to the template, and no GitHub repository");
    expect(text).toContain("acme/starter, branch main, commit 0123456 of 2026-01-05");
    expect(text).toContain("Packages are installed from npm");
    expect(text).toContain("A Clerk app and a Convex project are created");
    expect(text).toContain("you are asked to sign in in a browser");
    expect(text).toContain("The CI token step of the install is skipped");
    expect(text).toContain("runs commands inside the new project without asking for each one");
    expect(text).toContain("Alpha at the Full permission level");
    expect(text).toContain("It only works while the setup session's processes are running");
    // The project starts quiet, and the way to change that is named.
    expect(text).toContain("starts in Manual mode with automatic work off");
    expect(text).toContain("don't wake its project manager");
    expect(text).toContain("change the project's autonomy mode from Manual to Assisted");
    // No step comes before this one any more.
    expect(text).not.toContain("previous step");
  });

  it("changes with the answers", () => {
    const local = consentStatements({ ...input, secrets: "env_local", modules: ["blog"] });
    expect(local.join("\n")).toContain("written to .env.local");
    expect(local.join("\n")).toContain("Content modules installed: blog.");
    const reads = consentStatements({ ...input, provider: options.providers[1] as never });
    expect(reads.join("\n")).toContain("reads the template's install instructions");
  });

  it("with the deploy on, names the repository, the scope and what the session may do", () => {
    const deploy = { owner: "acme-org", repository: "my-site", vercelScope: "acme-team" };
    const text = consentStatements({ ...input, deploy }).join("\n");
    expect(text).toContain("pushed to a new private GitHub repository, acme-org/my-site");
    expect(text).toContain('a Vercel project named "my-site" in the scope "acme-team"');
    expect(text).toContain("public on a vercel.app address");
    expect(text).toContain("nothing is deployed with production keys");
    expect(text).toContain("told to stop and ask if anything differs");
    expect(text).toContain("A Doppler token is stored in the new repository");
    expect(text).toContain("The deployed one stays up; the local one only works while");
    expect(text).not.toContain("no GitHub repository");
    expect(text).toContain("one first commit and none of the template's history");
    // In the other repository mode it doesn't promise a fresh history.
    const clone = consentStatements({ ...input, deploy, repositoryMode: "clone" }).join("\n");
    expect(clone).toContain("as a clone of the template, with its history");
    expect(clone).not.toContain("none of the template's history");
  });
});
