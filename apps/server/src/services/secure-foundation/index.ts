import { tmpdir } from "node:os";
import {
  HARDEN_TEMPLATE_BRANCH,
  HARDEN_TEMPLATE_REPOSITORY,
  hardenTemplateUrl,
  StartSessionRequest,
} from "@codeden/contracts";
import type { Exec } from "../exec";
import type { FactoryService } from "../factory/factory-service";
import type { ProjectService } from "../projects/project-service";
import type { RunnerPort } from "../runner-port";
import type { SessionService } from "../sessions/session-service";
import type { SetupService } from "../setup/setup-service";
import { SecureFoundationService } from "./secure-foundation-service";
import { SecureFoundationSetups } from "./setups";
import type { TemplateSource } from "./template";

export { SecureFoundationService } from "./secure-foundation-service";

/** The build's template (`harden-channel.ts`), or null when the build has none. */
export function buildTemplate(): TemplateSource | null {
  const url = hardenTemplateUrl();
  return url
    ? { repository: HARDEN_TEMPLATE_REPOSITORY, branch: HARDEN_TEMPLATE_BRANCH, url }
    : null;
}

/** The service over the server's own projects, sessions, providers and setup checks. */
export function createSecureFoundation(deps: {
  exec: Exec;
  /** The app's home, where the answers a dev preview depends on are kept. */
  home: string;
  projectsDir: string;
  projects: ProjectService;
  /** Read when used: sessions are built after projects. */
  sessions: () => SessionService;
  /** The service that changes a project's autonomy mode. */
  factory: () => Pick<FactoryService, "setMode">;
  runner: Pick<RunnerPort, "providers">;
  setup: Pick<SetupService, "status">;
  template?: TemplateSource | null;
}): SecureFoundationService {
  return new SecureFoundationService({
    exec: deps.exec,
    template: deps.template === undefined ? buildTemplate() : deps.template,
    projectsDir: deps.projectsDir,
    tmpDir: tmpdir(),
    providers: () => deps.runner.providers(),
    preferredProvider: () => deps.sessions().configuredProvider("agent", null),
    setupStatus: () => deps.setup.status(),
    projects: deps.projects,
    setProjectMode: (projectId, mode) => deps.factory().setMode(projectId, { mode }),
    startSession: (req) => deps.sessions().start(StartSessionRequest.parse(req)),
    setups: new SecureFoundationSetups(deps.home),
  });
}
