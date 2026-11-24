import {
  type CreateSecureFoundationRequestInit,
  CreateSecureFoundationResponse,
  SECURE_FOUNDATION_DEFAULT_DEPLOY,
  SECURE_FOUNDATION_DEFAULT_SECRETS,
  SECURE_FOUNDATION_DEFAULT_SHELL,
  SECURE_FOUNDATION_NO_DEV_PREVIEW,
  SECURE_FOUNDATION_NO_REPO_SECRETS,
  SECURE_FOUNDATION_REPOSITORY_MODE,
  SECURE_FOUNDATION_SETUP_AUTONOMY,
  SecureFoundationConnections,
  SecureFoundationDevPreview,
  SecureFoundationFinish,
  SecureFoundationLogin,
  SecureFoundationOptions,
  SecureFoundationPrefill,
  SecureFoundationQuiet,
  SecureFoundationRepoSecrets,
  SecureFoundationRequirements,
  type SecureFoundationService,
  SecureFoundationTemplate,
  type SecureFoundationToolCheck,
  type VerifySecureFoundationRequestInit,
  VerifySecureFoundationResponse,
} from "@codeden/contracts";
import type { Fetcher } from "./http";

/** The "Secure Foundation" add-project option (`/api/secure-foundation`). */
export interface SecureFoundationApi {
  /** Whether this build has the option, and what its form needs. */
  options(): Promise<SecureFoundationOptions>;
  /** Suggestions for the form, read on this computer and stored nowhere. */
  prefill(): Promise<SecureFoundationPrefill>;
  /** The commit the template is at now, with its content modules. */
  template(): Promise<SecureFoundationTemplate>;
  /** What Go checks first: the fields, the folder, the template's commit and the provider. */
  verify(input: VerifySecureFoundationRequestInit): Promise<VerifySecureFoundationResponse>;
  /** Create the project and start its setup session. */
  create(input: CreateSecureFoundationRequestInit): Promise<CreateSecureFoundationResponse>;
  /** What a finished install left for the person (the Clerk claim link). */
  finish(projectId: string): Promise<SecureFoundationFinish>;
  /** Whether the project is a quiet Secure Foundation project, as the server knows it. */
  quiet(projectId: string): Promise<SecureFoundationQuiet>;
  /**
   * What the dev preview's settings form is filled with for a project Secure Foundation set up.
   * A suggestion only: storing it is the form's own Save and confirmation.
   */
  devPreview(projectId: string): Promise<SecureFoundationDevPreview>;
  /**
   * The repository secrets and variables the project's workflows use, and which of them its
   * GitHub repository has. Names only; nothing here sets one.
   */
  repositorySecrets(projectId: string): Promise<SecureFoundationRepoSecrets>;
  /** The same, read and asked again now (this computer only). */
  checkRepositorySecrets(projectId: string): Promise<SecureFoundationRepoSecrets>;
  /** The tools and sign-ins every setup needs, checked now (this computer only). */
  requirements(): Promise<SecureFoundationRequirements>;
  /** Whether this computer is signed in to each service (this computer only). */
  connections(services: SecureFoundationService[]): Promise<SecureFoundationConnections>;
  /** Start a service's own login, or join the one running. */
  startLogin(service: SecureFoundationService): Promise<SecureFoundationLogin>;
  /** A login as it stands now. */
  login(id: string): Promise<SecureFoundationLogin>;
  /** Stop a login. */
  cancelLogin(id: string): Promise<SecureFoundationLogin>;
}

export function httpSecureFoundationApi(http: Fetcher): SecureFoundationApi {
  const base = "/secure-foundation";
  return {
    options: () => http.get(base, (v) => SecureFoundationOptions.parse(v)),
    prefill: () => http.get(`${base}/prefill`, (v) => SecureFoundationPrefill.parse(v)),
    template: () => http.post(`${base}/template`, {}, (v) => SecureFoundationTemplate.parse(v)),
    verify: (input) =>
      http.post(`${base}/verify`, input, (v) => VerifySecureFoundationResponse.parse(v)),
    create: (input) =>
      http.post(`${base}/projects`, input, (v) => CreateSecureFoundationResponse.parse(v)),
    finish: (projectId) =>
      http.get(`${base}/projects/${encodeURIComponent(projectId)}/finish`, (v) =>
        SecureFoundationFinish.parse(v),
      ),
    quiet: (projectId) =>
      http.get(`${base}/projects/${encodeURIComponent(projectId)}/quiet`, (v) =>
        SecureFoundationQuiet.parse(v),
      ),
    devPreview: (projectId) =>
      http.get(`${base}/projects/${encodeURIComponent(projectId)}/dev-preview`, (v) =>
        SecureFoundationDevPreview.parse(v),
      ),
    repositorySecrets: (projectId) =>
      http.get(`${base}/projects/${encodeURIComponent(projectId)}/repository-secrets`, (v) =>
        SecureFoundationRepoSecrets.parse(v),
      ),
    checkRepositorySecrets: (projectId) =>
      http.post(
        `${base}/projects/${encodeURIComponent(projectId)}/repository-secrets/check`,
        {},
        (v) => SecureFoundationRepoSecrets.parse(v),
      ),
    requirements: () =>
      http.get(`${base}/requirements`, (v) => SecureFoundationRequirements.parse(v)),
    connections: (services) =>
      http.get(`${base}/connections?services=${services.join(",")}`, (v) =>
        SecureFoundationConnections.parse(v),
      ),
    startLogin: (service) =>
      http.post(`${base}/connections/${service}/login`, {}, (v) => SecureFoundationLogin.parse(v)),
    login: (id) =>
      http.get(`${base}/connections/logins/${encodeURIComponent(id)}`, (v) =>
        SecureFoundationLogin.parse(v),
      ),
    cancelLogin: (id) =>
      http.call("DELETE", `${base}/connections/logins/${encodeURIComponent(id)}`, undefined, (v) =>
        SecureFoundationLogin.parse(v),
      ),
  };
}

/** Made-up data: a computer where everything is installed and signed in. */
const MOCK_REQUIREMENTS: SecureFoundationRequirements = {
  checkedAt: "2026-01-05T10:00:00.000Z",
  platform: "darwin",
  tools: [
    { id: "node", version: "22.11.0", signedIn: null, message: "Installed." },
    { id: "npm", version: "10.9.0", signedIn: null, message: "Installed." },
    { id: "git", version: "2.47.0", signedIn: null, message: "Installed." },
    { id: "convex", version: "1.43.0", signedIn: true, message: "Signed in on this computer." },
    { id: "doppler", version: "3.75.1", signedIn: true, message: "Signed in on this computer." },
    { id: "gh", version: "2.62.0", signedIn: true, message: "Signed in on this computer." },
    { id: "vercel", version: "66.6.0", signedIn: true, message: "Signed in on this computer." },
  ].map((t) => ({ ...t, state: "ok" as const, found: true }) as SecureFoundationToolCheck),
};

/** The mock client has no template: the option is hidden, as in a build without one. */
export function mockSecureFoundationApi(): SecureFoundationApi {
  const off = () => Promise.reject(new Error("Secure Foundation needs the real server."));
  return {
    options: async () => ({
      enabled: false,
      template: null,
      projectsDir: "",
      pathSeparator: "/",
      providers: [],
      defaults: {
        secrets: SECURE_FOUNDATION_DEFAULT_SECRETS,
        shell: SECURE_FOUNDATION_DEFAULT_SHELL,
        deploy: SECURE_FOUNDATION_DEFAULT_DEPLOY,
      },
      repositoryMode: SECURE_FOUNDATION_REPOSITORY_MODE,
      autonomy: SECURE_FOUNDATION_SETUP_AUTONOMY,
    }),
    prefill: async () => ({ adminEmail: null }),
    template: off,
    verify: off,
    create: off,
    finish: async () => ({ clerkClaimUrl: null, deployedUrl: null }),
    quiet: async () => ({ quiet: false }),
    devPreview: async () => SECURE_FOUNDATION_NO_DEV_PREVIEW,
    repositorySecrets: async () => SECURE_FOUNDATION_NO_REPO_SECRETS,
    checkRepositorySecrets: async () => SECURE_FOUNDATION_NO_REPO_SECRETS,
    requirements: async () => MOCK_REQUIREMENTS,
    connections: async () => ({ connections: [] }),
    startLogin: off,
    login: off,
    cancelLogin: off,
  };
}
