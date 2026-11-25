import {
  describeRepoSecret,
  type Project,
  repoSecretsRepository,
  SECURE_FOUNDATION_NO_REPO_SECRETS,
  type SecureFoundationRepoSecrets,
  type SecureFoundationSetupRecord,
} from "@codeden/contracts";
import { type ExistingNames, existingNames, type GhRun } from "./github";
import { scanWorkflows } from "./scan";
import { readWorkflowFiles, type WorkflowFiles } from "./workflow-files";

export interface RepoSecretsDeps {
  projects: { get(id: string): Project };
  /** What the app kept when it created the project; null for any other, and for an older one. */
  kept: (projectId: string) => Pick<SecureFoundationSetupRecord, "secrets"> | null;
  /** The person's own `gh`, run the way the sign-in checks run it. */
  gh: GhRun;
  now?: () => Date;
  readWorkflows?: (projectPath: string) => WorkflowFiles;
}

/** What a request knows about the project that this service doesn't. */
export interface RepoSecretsKnown {
  /** The project has a setup session: Secure Foundation set it up. */
  setUp: () => boolean;
}

/** A result is shown again without asking GitHub for this long; "Check again" always asks. */
const FRESH_MS = 5 * 60_000;

const NOTHING: ExistingNames = { names: new Set(), problem: null };

/**
 * The repository secrets and variables a Secure Foundation project's workflows use, and which
 * of them its GitHub repository has (`packages/contracts/src/secure-foundation-repo-secrets.ts`).
 *
 * It reads the project's workflow files as text and asks GitHub for the names that exist. It
 * never sets, reads, asks for or stores a value, and it changes nothing on GitHub. The last
 * result per project is kept in memory, for the page and for another device, which is shown it
 * without anything being run.
 */
export class RepoSecretsService {
  private readonly held = new Map<string, SecureFoundationRepoSecrets>();
  private readonly running = new Map<string, Promise<SecureFoundationRepoSecrets>>();

  constructor(private readonly deps: RepoSecretsDeps) {}

  /**
   * What the project page shows. On this computer: the result kept for the project while it is
   * fresh and still about the same repository, else a new check. On another device: what is
   * kept, read-only, or nothing; nothing is read or run for it.
   */
  async view(
    projectId: string,
    opts: RepoSecretsKnown & { local: boolean },
  ): Promise<SecureFoundationRepoSecrets> {
    const kept = this.held.get(projectId);
    if (!opts.local) return kept ? { ...kept, canCheck: false } : SECURE_FOUNDATION_NO_REPO_SECRETS;
    const project = this.project(projectId);
    if (!project || !this.applies(projectId, opts)) return SECURE_FOUNDATION_NO_REPO_SECRETS;
    const at = kept?.checkedAt ? Date.parse(kept.checkedAt) : Number.NaN;
    const age = this.now().getTime() - at;
    if (kept && kept.repository === repositoryOf(project) && age >= 0 && age < FRESH_MS) {
      return kept;
    }
    return this.check(projectId, opts);
  }

  /** Read the workflow files and ask GitHub again. One check per project at a time. */
  check(projectId: string, opts: RepoSecretsKnown): Promise<SecureFoundationRepoSecrets> {
    const running = this.running.get(projectId);
    if (running) return running;
    const started = this.run(projectId, opts).finally(() => this.running.delete(projectId));
    this.running.set(projectId, started);
    return started;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private project(projectId: string): Project | null {
    try {
      return this.deps.projects.get(projectId);
    } catch {
      return null;
    }
  }

  private applies(projectId: string, opts: RepoSecretsKnown): boolean {
    return this.deps.kept(projectId) !== null || opts.setUp();
  }

  private async run(
    projectId: string,
    opts: RepoSecretsKnown,
  ): Promise<SecureFoundationRepoSecrets> {
    const project = this.project(projectId);
    if (!project || !this.applies(projectId, opts)) {
      this.held.delete(projectId);
      return SECURE_FOUNDATION_NO_REPO_SECRETS;
    }
    const { files, skipped } = (this.deps.readWorkflows ?? readWorkflowFiles)(project.path);
    const scan = scanWorkflows(files);
    const repository = repositoryOf(project);
    const common = {
      applies: true,
      repository,
      checkedAt: this.now().toISOString(),
      inherits: scan.inherits,
      skipped,
      canCheck: true,
    };
    let result: SecureFoundationRepoSecrets;
    if (!repository) {
      result = {
        ...common,
        github: "no_repository",
        message: null,
        items: scan.references.map((r) => describeRepoSecret(r, null, null)),
      };
    } else {
      // Only what is referenced is asked about: a project without `vars.` never lists variables.
      const wanted = (kind: "secret" | "variable") =>
        scan.references.some((r) => r.kind === kind)
          ? existingNames(this.deps.gh, kind, repository)
          : NOTHING;
      const [secrets, variables] = await Promise.all([wanted("secret"), wanted("variable")]);
      const context = { repository, secrets: this.deps.kept(projectId)?.secrets ?? null };
      const problem = secrets.problem ?? variables.problem;
      result = {
        ...common,
        github: problem ? "unavailable" : "checked",
        message: problem ? `Which of these are already set couldn't be checked. ${problem}` : null,
        items: scan.references.map((r) => {
          const { names } = r.kind === "secret" ? secrets : variables;
          return describeRepoSecret(r, names ? names.has(r.name) : null, context);
        }),
      };
    }
    this.held.set(projectId, result);
    return result;
  }
}

/** The project's GitHub repository as `owner/repo`; null for a local project, or an odd name. */
function repositoryOf(project: Project): string | null {
  return project.kind === "github"
    ? repoSecretsRepository(project.github.owner, project.github.repo)
    : null;
}
