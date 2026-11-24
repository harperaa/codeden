import { describe, expect, it } from "vitest";
import {
  describeRepoSecret,
  type RepoSecretReference,
  repoSecretName,
  repoSecretRuns,
  repoSecretsRepository,
  repoSecretWhere,
  SECURE_FOUNDATION_KNOWN_REPO_SECRETS,
  SECURE_FOUNDATION_NO_REPO_SECRETS,
  SecureFoundationRepoSecret,
  SecureFoundationRepoSecrets,
} from "../src/index";

const roundTrip = <T>(schema: { parse: (v: unknown) => T }, value: unknown): T =>
  schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));

const event = (name: string, filtered = false) => ({ name, filtered });
const review: RepoSecretReference = {
  kind: "secret",
  name: "CLAUDE_CODE_OAUTH_TOKEN",
  uses: [
    {
      workflow: "claude-code-review.yml",
      jobs: ["security-review", "claude-review"],
      events: [event("pull_request")],
      mention: null,
    },
    {
      workflow: "claude.yml",
      jobs: ["claude"],
      events: [event("issue_comment"), event("issues")],
      mention: "@claude",
    },
  ],
};
const doppler: RepoSecretReference = {
  kind: "secret",
  name: "DOPPLER_TOKEN",
  uses: [
    {
      workflow: "ci.yml",
      jobs: ["build"],
      events: [event("push", true), event("pull_request", true)],
      mention: null,
    },
  ],
};
const other = (kind: "secret" | "variable", name: string): RepoSecretReference => ({
  kind,
  name,
  uses: [{ workflow: "deploy.yml", jobs: [], events: [event("release")], mention: null }],
});
const at = (secrets: "doppler" | "env_local" | null = "doppler") => ({
  repository: "octo/my-site",
  secrets,
});

/** Everything a shell gives a meaning to, and what GitHub refuses in a name. */
const ODD = [
  "MY TOKEN",
  "MY-TOKEN",
  "TOKEN;rm -rf ~",
  "$(id)",
  "`id`",
  "A|B",
  "A&B",
  "A>B",
  "A'B",
  'A"B',
  "A\\B",
  "A\nB",
  "../TOKEN",
  "1TOKEN",
  "",
  "É",
  "A".repeat(129),
];

describe("names", () => {
  it("reads a name the way GitHub stores it", () => {
    expect(repoSecretName("claude_code_oauth_token")).toBe("CLAUDE_CODE_OAUTH_TOKEN");
    expect(repoSecretName("_PRIVATE_1")).toBe("_PRIVATE_1");
  });

  it("refuses every name with a character GitHub doesn't allow", () => {
    for (const name of ODD) expect(repoSecretName(name), JSON.stringify(name)).toBeNull();
    for (const name of [null, undefined, 7, {}, ["A"]]) expect(repoSecretName(name)).toBeNull();
  });

  it("leaves out what GitHub provides itself", () => {
    expect(repoSecretName("GITHUB_TOKEN")).toBeNull();
    expect(repoSecretName("github_token")).toBeNull();
    expect(repoSecretName("GITHUB_ANYTHING")).toBeNull();
  });

  it("only makes a repository reference from plain owner and repository names", () => {
    expect(repoSecretsRepository("octo", "my-site")).toBe("octo/my-site");
    expect(repoSecretsRepository("octo", "my.site_2")).toBe("octo/my.site_2");
    for (const [owner, repo] of [
      ["octo", "my site"],
      ["octo", "a/b"],
      ["octo", "--json=value"],
      ["octo", "site.git"],
      ["octo", "site;id"],
      ["-octo", "site"],
      ["oc to", "site"],
      ["octo/evil", "site"],
      ["", "site"],
      ["octo", ""],
      [null, "site"],
    ] as const) {
      expect(repoSecretsRepository(owner, repo), `${owner}/${repo}`).toBeNull();
    }
  });
});

describe("where a name is used", () => {
  it("says which jobs, and when they run", () => {
    expect(repoSecretWhere(review.uses)).toBe(
      "`claude-code-review.yml` (jobs `security-review` and `claude-review`) runs on every pull request. `claude.yml` (job `claude`) runs only when someone mentions @claude.",
    );
    expect(repoSecretWhere(doppler.uses)).toBe(
      "`ci.yml` (job `build`) runs on pushes and pull requests to the branches or paths it names.",
    );
    expect(repoSecretWhere(other("secret", "X").uses)).toBe(
      "`deploy.yml` (the whole workflow) runs on releases.",
    );
  });

  it("names an event it has no words for, and copes with none", () => {
    expect(
      repoSecretRuns({ events: [event("push"), event("deployment_status")], mention: null }),
    ).toBe("on every push and on `deployment_status`");
    expect(repoSecretRuns({ events: [], mention: null })).toBe("when its workflow runs");
  });

  it("says that a called workflow's secret may be the caller's name for it", () => {
    const [use] = other("secret", "X").uses;
    expect(repoSecretWhere([{ ...use, events: [event("workflow_call")] } as never])).toContain(
      "gets its secrets from the workflow that calls it",
    );
  });
});

describe("what the person is told about a name", () => {
  it("gives Claude Code's own steps for the Claude token, with the page they come from", () => {
    const item = describeRepoSecret(review, false, at());
    expect(item.state).toBe("missing");
    expect(item.purpose).toContain("anthropics/claude-code-action");
    // The template's GitHub-side reviews need it; the app and its reviews on this computer don't.
    expect(item.purpose).toContain("The sign-in of the template's Claude review workflows");
    expect(item.purpose).toContain("They run on GitHub's servers, not on this computer");
    expect(item.purpose).toContain(
      "The setup doesn't add it: creating it needs your own Claude sign-in, and the token would have passed through the setup session's transcript.",
    );
    expect(item.purpose).toMatch(
      /Reviews you run inside \S+ use your own subscription on this computer and don't need it\./,
    );
    expect(item.consequence).toContain(
      "the template's Claude review checks have no sign-in and fail shortly after they start",
    );
    expect(item.consequence).toContain("(the review on every pull request)");
    expect(item.steps[0]).toContain("`claude setup-token`");
    expect(item.steps[1]).toContain("`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo octo/my-site`");
    expect(item.steps[1]).toContain("Settings › Secrets and variables › Actions");
    expect(item.steps[2]).toContain("https://github.com/apps/claude");
    expect(item.source?.url).toBe("https://code.claude.com/docs/en/github-actions");
    roundTrip(SecureFoundationRepoSecret, item);
  });

  it("gives the template's own step for the Doppler token, and none without Doppler", () => {
    const withDoppler = describeRepoSecret(doppler, false, at("doppler"));
    expect(withDoppler.state).toBe("missing");
    expect(withDoppler.steps[0]).toContain("`node scripts/setup.mjs doppler-create-ci-token`");
    expect(withDoppler.source?.url).toContain("/.claude/commands/install.md");

    const envLocal = describeRepoSecret(doppler, false, at("env_local"));
    expect(envLocal).toMatchObject({ state: "not_needed", steps: [], source: null });
    expect(envLocal.consequence).toContain("`.env.local`");
    // Not needed whether or not GitHub could be asked.
    expect(describeRepoSecret(doppler, null, at("env_local")).state).toBe("not_needed");

    // A project made before the app kept the secrets mode: the step, and when it applies.
    const older = describeRepoSecret(doppler, false, at(null));
    expect(older.state).toBe("missing");
    expect(older.steps[0]).toContain("Only when this project's secrets are in Doppler");
  });

  it("shows a name that is set as set, with nothing to do", () => {
    for (const reference of [review, doppler, other("variable", "REGION")]) {
      expect(describeRepoSecret(reference, true, at())).toMatchObject({
        state: "set",
        steps: [],
        consequence: "It is set in the repository.",
      });
    }
    // Set is set, even where the project wouldn't need it.
    expect(describeRepoSecret(doppler, true, at("env_local")).state).toBe("set");
  });

  it("gives generic steps for a name it doesn't know, a secret or a variable", () => {
    const secret = describeRepoSecret(other("secret", "NPM_TOKEN"), false, at());
    expect(secret).toMatchObject({ state: "missing", purpose: null, source: null });
    expect(secret.steps.join(" ")).toContain("New repository secret");
    expect(secret.steps.join(" ")).toContain("`gh secret set NPM_TOKEN --repo octo/my-site`");

    const variable = describeRepoSecret(other("variable", "REGION"), false, at());
    expect(variable.steps.join(" ")).toContain("New repository variable");
    expect(variable.steps.join(" ")).toContain("`gh variable set REGION --repo octo/my-site`");
    // A variable called like a known secret is still an unknown variable.
    expect(describeRepoSecret(other("variable", "DOPPLER_TOKEN"), false, at()).purpose).toBeNull();
  });

  it("says so when GitHub couldn't be asked, and still gives the steps", () => {
    const item = describeRepoSecret(review, null, at());
    expect(item.state).toBe("unknown");
    expect(item.consequence).toMatch(/^Whether it is set couldn't be checked\./);
    expect(item.steps.length).toBeGreaterThan(0);
  });

  it("has no steps while the project has no repository to name in them", () => {
    expect(describeRepoSecret(review, null, null)).toMatchObject({ state: "unknown", steps: [] });
  });

  it("never asks for a value, and never shows a command that carries one", () => {
    const texts = [review, doppler, other("secret", "NPM_TOKEN"), other("variable", "REGION")]
      .flatMap((r) => [false, null].map((e) => describeRepoSecret(r, e as never, at(null))))
      .flatMap((item) => [...item.steps, item.consequence]);
    for (const text of texts) {
      expect(text).not.toMatch(/--body|-b |--env-file|echo |<<</);
      expect(text).not.toMatch(/paste (it|your token) here/i);
    }
    // Every known name has a purpose, a consequence and at least one step.
    for (const known of Object.values(SECURE_FOUNDATION_KNOWN_REPO_SECRETS)) {
      expect(known.purpose.length).toBeGreaterThan(10);
      expect(known.steps(at()).length).toBeGreaterThan(0);
    }
  });
});

describe("the answer of the route", () => {
  it("round-trips, with and without a repository", () => {
    const checked = {
      applies: true,
      repository: "octo/my-site",
      checkedAt: "2026-01-05T10:00:00.000Z",
      github: "checked",
      message: null,
      items: [describeRepoSecret(review, false, at()), describeRepoSecret(doppler, true, at())],
      inherits: [{ workflow: "release.yml", job: "publish" }],
      skipped: 1,
      canCheck: true,
    };
    expect(roundTrip(SecureFoundationRepoSecrets, checked)).toEqual(checked);
    expect(roundTrip(SecureFoundationRepoSecrets, SECURE_FOUNDATION_NO_REPO_SECRETS)).toEqual(
      SECURE_FOUNDATION_NO_REPO_SECRETS,
    );
  });

  it("only takes a link to a page over https as the source of the steps", () => {
    const item = describeRepoSecret(review, false, at());
    for (const url of ["javascript:alert(1)", "http://example.test/x", "data:text/html,x"]) {
      const source = { title: "A page", url };
      expect(SecureFoundationRepoSecret.safeParse({ ...item, source }).success, url).toBe(false);
    }
  });

  it("names the first few of a long list and counts the rest", () => {
    const many = Array.from({ length: 12 }, (_, i) => `job-${i}`);
    const events = Array.from({ length: 9 }, (_, i) => event(`custom_${i}`));
    const uses = Array.from({ length: 11 }, (_, i) => ({
      workflow: `w${i}.yml`,
      jobs: many,
      events,
      mention: null,
    }));
    const where = repoSecretWhere(uses);
    expect(where).toContain("`job-5` and 6 more jobs");
    expect(where).toContain("on `custom_5` and on other events");
    expect(where).toContain("And 3 more workflow files.");
    expect(where).not.toContain("w8.yml");
  });

  it("refuses an item whose name isn't a plain name", () => {
    const item = describeRepoSecret(review, false, at());
    for (const name of ["my token", "TOKEN;id", "token"]) {
      expect(SecureFoundationRepoSecret.safeParse({ ...item, name }).success, name).toBe(false);
    }
  });
});
