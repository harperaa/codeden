import {
  describeRepoSecret,
  type Project,
  type RepoSecretReference,
  SECURE_FOUNDATION_NO_REPO_SECRETS,
  SECURE_FOUNDATION_WORK_KEY,
  type SecureFoundationRepoSecrets,
  type Session,
  type Snapshot,
} from "@codeden/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SecureFoundationStatus } from "@/components/harden/secure-foundation/status";
import type { CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";
import { renderWithClient } from "./utils";

/**
 * The repository secrets a Secure Foundation project's workflows need, on the project page's
 * card beside the Clerk claim: what is missing, with its steps, and nothing that takes a value.
 */
const REPO = "octo/my-site";
const CLAIM = "https://dashboard.clerk.com/apps/claim?token=fixture";
const pull = [{ name: "pull_request", filtered: false }];
const claude: RepoSecretReference = {
  kind: "secret",
  name: "CLAUDE_CODE_OAUTH_TOKEN",
  uses: [
    {
      workflow: "claude-code-review.yml",
      jobs: ["security-review", "claude-review"],
      events: pull,
      mention: null,
    },
    {
      workflow: "claude.yml",
      jobs: ["claude"],
      events: [{ name: "issue_comment", filtered: false }],
      mention: "@claude",
    },
  ],
};
const doppler: RepoSecretReference = {
  kind: "secret",
  name: "DOPPLER_TOKEN",
  uses: [{ workflow: "ci.yml", jobs: ["build"], events: pull, mention: null }],
};
const region: RepoSecretReference = {
  kind: "variable",
  name: "REGION",
  uses: [{ workflow: "deploy.yml", jobs: [], events: pull, mention: null }],
};
const context = { repository: REPO, secrets: "doppler" as const };

const answer = (over: Partial<SecureFoundationRepoSecrets> = {}): SecureFoundationRepoSecrets => ({
  applies: true,
  repository: REPO,
  checkedAt: "2026-01-05T10:00:00.000Z",
  github: "checked",
  message: null,
  items: [describeRepoSecret(claude, false, context), describeRepoSecret(doppler, true, context)],
  inherits: [],
  skipped: 0,
  canCheck: true,
  ...over,
});

/**
 * The card of the mock's first project, set up by Secure Foundation. `progress` is what the
 * setup session reported last; without `setup` that session has left the snapshot.
 */
async function card(
  secrets: SecureFoundationRepoSecrets,
  opts: {
    progress?: string;
    setup?: boolean;
    mode?: Project["autonomyMode"];
    check?: () => Promise<SecureFoundationRepoSecrets>;
  } = {},
) {
  const client = createMockClient();
  const snapshot = await client.getSnapshot();
  const project = {
    ...(snapshot.projects[0] as Project),
    autonomyMode: opts.mode ?? "manual",
  } as Project;
  const session = {
    ...(snapshot.sessions[0] as Session),
    id: "s-setup",
    projectId: project.id,
    workKey: SECURE_FOUNDATION_WORK_KEY,
    status: "idle",
    progress: {
      text: opts.progress ?? "Secure Foundation: running at http://localhost:3000",
      at: "",
    },
    archivedAt: null,
  } as Session;
  const world: Snapshot = {
    ...snapshot,
    projects: [project],
    sessions: opts.setup === false ? [] : [session],
  };
  const asked = vi.fn(async () => secrets);
  const check = vi.fn(opts.check ?? (async () => secrets));
  renderWithClient(
    <SecureFoundationStatus projectId={project.id} />,
    {
      ...client,
      getSnapshot: async () => world,
      secureFoundation: {
        ...client.secureFoundation,
        finish: async () => ({ clerkClaimUrl: CLAIM, deployedUrl: "https://my-site.vercel.app" }),
        repositorySecrets: asked,
        checkRepositorySecrets: check,
      },
    } as CodeDenClient,
    { withRouter: true },
  );
  return { asked, check };
}

const entry = (section: HTMLElement, name: string) =>
  within(section)
    .getAllByTestId("secure-foundation-secret")
    .find((e) => e.getAttribute("data-name") === name) as HTMLElement;

describe("the repository secrets on the Secure Foundation card", () => {
  it("lists a missing secret with what it is for, where it is used and the steps, beside the claim", async () => {
    await card(answer());
    const section = await screen.findByTestId("secure-foundation-secrets");
    // On the same card as the Clerk claim.
    const whole = screen.getByTestId("secure-foundation-status");
    expect(await within(whole).findByTestId("secure-foundation-claim")).toBeTruthy();
    expect(whole.contains(section)).toBe(true);

    expect(within(section).getByTestId("secure-foundation-secrets-summary").textContent).toBe(
      `1 of the 2 this project's workflows use is not set in ${REPO}.`,
    );
    const missing = entry(section, "CLAUDE_CODE_OAUTH_TOKEN");
    expect(missing.getAttribute("data-state")).toBe("missing");
    const text = missing.textContent ?? "";
    expect(text).toContain("not set");
    expect(text).toContain("anthropics/claude-code-action");
    expect(text).toContain("claude-code-review.yml (jobs security-review and claude-review)");
    expect(text).toContain("runs on every pull request");
    expect(text).toContain("only when someone mentions @claude");
    expect(text).toContain("fail shortly after they start");
    // The template's GitHub-side reviews need it, not the app or its reviews on this computer.
    expect(text).toContain("They run on GitHub's servers, not on this computer");
    expect(text).toContain("The template's deploy skips it by default.");
    const steps = [...missing.querySelectorAll("ol > li")].map((li) => li.textContent ?? "");
    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain("claude setup-token");
    expect(steps[1]).toContain(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${REPO}`);
    expect(steps[1]).toContain("New repository secret");
    // The commands are marked as commands.
    expect([...missing.querySelectorAll("code")].map((c) => c.textContent)).toContain(
      "claude setup-token",
    );
    const source = within(missing).getByRole("link");
    expect(source.getAttribute("href")).toBe("https://code.claude.com/docs/en/github-actions");

    // What the deploy stored is shown as set, not as missing.
    expect(within(section).getByTestId("secure-foundation-secrets-set").textContent).toBe(
      "Already set: DOPPLER_TOKEN.",
    );
    expect(within(section).getAllByTestId("secure-foundation-secret")).toHaveLength(1);
  });

  it("has no field to type a value into, anywhere on the card", async () => {
    await card(answer());
    await screen.findByTestId("secure-foundation-secrets");
    const whole = screen.getByTestId("secure-foundation-status");
    expect(whole.querySelector("input, textarea, [contenteditable]")).toBeNull();
    expect(whole.textContent).toContain("A value is never typed in here.");
  });

  it("asks again on Check again and shows the new answer", async () => {
    const allSet = answer({
      items: [
        describeRepoSecret(claude, true, context),
        describeRepoSecret(doppler, true, context),
      ],
    });
    const { check, asked } = await card(answer(), { check: async () => allSet });
    const section = await screen.findByTestId("secure-foundation-secrets");
    fireEvent.click(within(section).getByTestId("secure-foundation-secrets-check"));
    await waitFor(() =>
      expect(screen.getByTestId("secure-foundation-secrets-summary").textContent).toBe(
        `Everything this project's workflows use is set in ${REPO}, or not needed.`,
      ),
    );
    expect(check).toHaveBeenCalledTimes(1);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("secure-foundation-secret")).toBeNull();
    expect(screen.getByTestId("secure-foundation-secrets-set").textContent).toBe(
      "Already set: CLAUDE_CODE_OAUTH_TOKEN, DOPPLER_TOKEN.",
    );
  });

  it("lists the names as unchecked when GitHub couldn't be asked, instead of hiding them", async () => {
    await card(
      answer({
        github: "unavailable",
        message:
          "Which of these are already set couldn't be checked. `gh` isn't signed in to GitHub on this computer: run `gh auth login` in your own terminal.",
        items: [
          describeRepoSecret(claude, null, context),
          describeRepoSecret(doppler, null, context),
        ],
      }),
    );
    const section = await screen.findByTestId("secure-foundation-secrets");
    expect(within(section).getByTestId("secure-foundation-secrets-problem").textContent).toContain(
      "couldn't be checked",
    );
    const entries = within(section).getAllByTestId("secure-foundation-secret");
    expect(entries.map((e) => e.getAttribute("data-state"))).toEqual(["unknown", "unknown"]);
    expect(entries[0]?.textContent).toContain("couldn't check");
    // The steps are still there for the one that turns out to be missing.
    expect(entries[0]?.querySelectorAll("ol > li").length).toBe(4);
    expect(within(section).getByTestId("secure-foundation-secrets-check")).toBeTruthy();
  });

  it("says a secret isn't needed where the project works without it, and names variables", async () => {
    const envLocal = { repository: REPO, secrets: "env_local" as const };
    await card(
      answer({
        items: [
          describeRepoSecret(doppler, false, envLocal),
          describeRepoSecret(region, false, envLocal),
        ],
        inherits: [{ workflow: "release.yml", job: "publish" }],
        skipped: 2,
      }),
    );
    const section = await screen.findByTestId("secure-foundation-secrets");
    expect(
      within(section).getByTestId("secure-foundation-secrets-not-needed").textContent,
    ).toContain("Not needed here: DOPPLER_TOKEN. This project keeps its secrets in .env.local");
    const variable = entry(section, "REGION");
    expect(variable.textContent).toContain("variable, not set");
    expect(variable.textContent).toContain(`gh variable set REGION --repo ${REPO}`);
    expect(within(section).getByTestId("secure-foundation-secrets-inherits").textContent).toContain(
      "Inherits all: job publish of release.yml",
    );
    expect(section.textContent).toContain("2 workflow files were not read");
  });

  it("says one line, without steps, while the project has no GitHub repository", async () => {
    await card(
      answer({
        repository: null,
        github: "no_repository",
        items: [describeRepoSecret(claude, null, null), describeRepoSecret(doppler, null, null)],
      }),
    );
    const section = await screen.findByTestId("secure-foundation-secrets");
    expect(section.tagName).toBe("P");
    expect(section.textContent).toContain(
      "this project's workflows use CLAUDE_CODE_OAUTH_TOKEN, DOPPLER_TOKEN. They matter once the project has a GitHub repository",
    );
    expect(screen.queryByTestId("secure-foundation-secret")).toBeNull();
    expect(screen.queryByTestId("secure-foundation-secrets-check")).toBeNull();
  });

  it("offers no Check again on another device", async () => {
    await card(answer({ canCheck: false }));
    const section = await screen.findByTestId("secure-foundation-secrets");
    expect(within(section).queryByTestId("secure-foundation-secrets-check")).toBeNull();
    expect(section.textContent).toContain("Checked on the computer running the app");
    expect(entry(section, "CLAUDE_CODE_OAUTH_TOKEN")).toBeTruthy();
  });

  it("says nothing when the workflows use no secret, and for a project it doesn't apply to", async () => {
    await card(answer({ items: [] }));
    await screen.findByTestId("secure-foundation-created");
    expect(screen.queryByTestId("secure-foundation-secrets")).toBeNull();
  });

  it("doesn't ask while the setup is still installing: the repository isn't there yet", async () => {
    const { asked } = await card(answer(), { progress: "Secure Foundation: installing" });
    await screen.findByTestId("secure-foundation-status");
    expect(asked).not.toHaveBeenCalled();
    expect(screen.queryByTestId("secure-foundation-secrets")).toBeNull();
  });

  it("shows on a project made earlier, whose setup session is gone and whose mode was changed", async () => {
    await card(answer(), { setup: false, mode: "assisted" });
    const whole = await screen.findByTestId("secure-foundation-status");
    const section = within(whole).getByTestId("secure-foundation-secrets");
    expect(entry(section, "CLAUDE_CODE_OAUTH_TOKEN").textContent).toContain("claude setup-token");
    // Nothing else of the setup is claimed for it.
    expect(within(whole).queryByTestId("secure-foundation-quiet")).toBeNull();
  });

  it("keeps no card on such a project once nothing is missing, or while it has no repository", async () => {
    const allSet = answer({ items: [describeRepoSecret(doppler, true, context)] });
    const local = answer({
      repository: null,
      github: "no_repository",
      items: [describeRepoSecret(claude, null, null)],
    });
    for (const secrets of [allSet, local]) {
      const { asked } = await card(secrets, { setup: false, mode: "assisted" });
      await waitFor(() => expect(asked).toHaveBeenCalled());
      expect(screen.queryByTestId("secure-foundation-status")).toBeNull();
    }
  });

  it("shows no card for another project", async () => {
    const { asked } = await card(SECURE_FOUNDATION_NO_REPO_SECRETS, {
      setup: false,
      mode: "assisted",
    });
    await waitFor(() => expect(asked).toHaveBeenCalled());
    expect(screen.queryByTestId("secure-foundation-status")).toBeNull();
  });
});
