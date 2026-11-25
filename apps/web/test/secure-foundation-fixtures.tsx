import type {
  SecureFoundationCheckId,
  SecureFoundationConnection,
  SecureFoundationOptions,
  SecureFoundationTemplate,
  VerifySecureFoundationResponse,
} from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import type { FormAnswers } from "@/components/harden/secure-foundation/answers";
import { SecureFoundationDialog } from "@/components/harden/secure-foundation/dialog";
import type { CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";
import { renderWithClient } from "./utils";

/** What the Secure Foundation tests share: made-up options, a template and a scripted client. */

export const options: SecureFoundationOptions = {
  enabled: true,
  template: { repository: "acme/starter", branch: "main" },
  projectsDir: "/work/projects",
  pathSeparator: "/",
  providers: [
    { id: "alpha", displayName: "Alpha", runsCommandFiles: true },
    { id: "beta", displayName: "Beta", runsCommandFiles: false },
  ],
  defaults: { secrets: "doppler", shell: "all", deploy: false },
  repositoryMode: "fresh",
  autonomy: "full",
};
export const template: SecureFoundationTemplate = {
  repository: "acme/starter",
  branch: "main",
  commit: "0123456789abcdef0123456789abcdef01234567",
  committedAt: "2026-01-05T10:00:00.000Z",
  modules: [
    { name: "blog", title: "Blog", description: "A blog" },
    { name: "pricing", title: "Pricing", description: "A pricing page" },
  ],
};
export const blank: FormAnswers = {
  name: "",
  adminEmail: "",
  emailTouched: false,
  secrets: "doppler",
  shell: "all",
  modules: [],
  provider: "alpha",
  deploy: false,
};
export const EMAIL = "person@site.test";

export const connection = (
  service: SecureFoundationConnection["service"],
  patch: Partial<SecureFoundationConnection> = {},
): SecureFoundationConnection => ({
  service,
  cli: "ready",
  signedIn: true,
  message: `Signed in to ${service}.`,
  install: null,
  teams: [],
  account: null,
  owners: [],
  lastOwner: null,
  missingScopes: [],
  scopes: [],
  ...patch,
});

const IDS: SecureFoundationCheckId[] = ["fields", "folder", "template", "provider"];
/** The server's checks, all passed unless one is replaced. */
export const verified = (
  patch: Partial<Record<SecureFoundationCheckId, { message: string; fix: string }>> = {},
  now: SecureFoundationTemplate | null = template,
): VerifySecureFoundationResponse => ({
  checks: IDS.map((id) =>
    patch[id]
      ? { id, status: "failed" as const, ...patch[id] }
      : { id, status: "passed" as const, message: `${id} is fine.`, fix: null },
  ),
  template: now,
});

type Api = CodeDenClient["secureFoundation"];
export const clientWith = (sf: Partial<Api>): CodeDenClient => {
  const client = createMockClient();
  return { ...client, secureFoundation: { ...client.secureFoundation, ...sf } };
};

/**
 * The dialog on a scripted client: the template resolved, the email suggested, every server
 * check passing and every needed service signed in, unless `sf` says otherwise.
 */
export function openDialog(sf: Partial<Api> = {}, opts: Partial<SecureFoundationOptions> = {}) {
  const onClose = vi.fn();
  const create = vi.fn<Api["create"]>(async () => ({
    project: { id: "p1" } as never,
    sessionId: "s1",
    commit: template.commit,
  }));
  const verify = vi.fn<Api["verify"]>(async () => verified());
  const connections = vi.fn<Api["connections"]>(async (services) => ({
    connections: services.map((s) => connection(s)),
  }));
  const { unmount } = renderWithClient(
    <SecureFoundationDialog options={{ ...options, ...opts }} onClose={onClose} />,
    clientWith({
      template: async () => template,
      prefill: async () => ({ adminEmail: EMAIL }),
      verify,
      connections,
      create,
      ...sf,
    }),
    { withRouter: true },
  );
  return {
    onClose,
    create: (sf.create as typeof create) ?? create,
    verify,
    connections,
    /** The add-project dialog closing this one. */
    close: unmount,
  };
}

export const goButton = () => screen.getByTestId("secure-foundation-go") as HTMLButtonElement;

/** Type the project name and wait until Go is there (the template and the email arrived). */
export async function typeName(name = "My Site") {
  fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: name } });
  await waitFor(() => expect(goButton().disabled).toBe(false));
}

export const statusOf = (testId: string) => screen.getByTestId(testId).getAttribute("data-status");
