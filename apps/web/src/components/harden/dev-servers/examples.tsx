import {
  type DevPreviewConfig,
  type DevPreviewProject,
  type DevPreviewState,
  defaultDevPreviewLimits,
  devPreviewBaseKey,
  type Project,
  SECURE_FOUNDATION_NO_DEV_PREVIEW,
} from "@codeden/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, type SyntheticEvent, useState } from "react";
import { DevPreviewPmBar } from "@/components/harden/dev-preview/bar";
import { DevPreviewProjectSettings } from "@/components/harden/dev-preview/project-settings";
import { ClientProvider, type CodeDenClient } from "@/lib/api";
import type { DevPreviewApi } from "@/lib/api/dev-preview-api";

/**
 * Example pictures for the Dev Servers page's instructions: the product's own strip and
 * settings section, drawn with made-up data. They are the real components, so they follow the
 * theme and never go out of date, and there is no image file.
 *
 * They can do nothing. Each is rendered over a client of its own that holds fixed answers and
 * whose every changing call does nothing (it never reaches the server, and the page's real
 * client isn't visible from inside), inside an `inert` box that swallows clicks and keys and is
 * hidden from assistive technology. The figure's label and caption say what it shows.
 */

/** Made-up names only: nothing here is read from this computer. */
const OFF = "example-off";
const ON = "example-on";
const SETTINGS_OF = "example-my-site";
const CONFIRMED = "2026-01-05T09:00:00.000Z";

function exampleState(projectId: string): DevPreviewState {
  const on = projectId === ON;
  return {
    key: devPreviewBaseKey(projectId),
    kind: "base",
    projectId,
    sessionId: null,
    status: on ? "running" : "off",
    enabled: on,
    url: on ? "http://localhost:43100" : null,
    ports: on ? [43100] : [],
    message: null,
    logTail: [],
    startedAt: null,
    configured: true,
    unavailable: null,
    remote: false,
    base: { branch: "main", commit: on ? "0123456789" : null, checkedAt: null, blocked: false },
  };
}

const exampleConfig: DevPreviewConfig = {
  command: "pnpm dev",
  prepareCommand: "pnpm install --frozen-lockfile",
  portVars: ["PORT"],
  urlFrom: "port",
  urlPattern: null,
  pmEnabled: false,
  confirmedAt: CONFIRMED,
  baseBranch: "main",
};

function exampleProject(projectId: string): DevPreviewProject {
  return {
    projectId,
    config: exampleConfig,
    suggestion: null,
    recommended: null,
    baseBranch: "main",
    notice: null,
    remote: false,
  };
}

/** Fixed answers; whatever would start, stop or store something answers the same and does nothing. */
const exampleApi: DevPreviewApi = {
  limits: async () => ({ limits: defaultDevPreviewLimits(), remote: false }),
  setLimits: async () => ({ limits: defaultDevPreviewLimits(), remote: false }),
  project: async (id) => exampleProject(id),
  confirmProject: async (id) => exampleProject(id),
  removeProject: async (id) => exampleProject(id),
  session: async () => exampleState(OFF),
  startSession: async () => exampleState(OFF),
  stopSession: async () => exampleState(OFF),
  base: async (id) => exampleState(id),
  setPm: async (id) => exampleState(id),
  updateBase: async (id) => exampleState(id),
  log: async (key) => ({ key, lines: [] }),
  stopAll: async () => ({ stopped: 0, failed: [] }),
  servers: async () => ({ servers: [], remote: false }),
  stopServers: async () => ({ stopped: [], failed: [] }),
  stopAllServers: async () => ({ stopped: [], failed: [] }),
};

/**
 * The only two parts of the client the strip and the settings section read. Nothing else is
 * there, so no other call can be made from inside an example.
 */
const exampleClient = {
  kind: "mock",
  devPreview: exampleApi,
  secureFoundation: { devPreview: async () => SECURE_FOUNDATION_NO_DEV_PREVIEW },
} as unknown as CodeDenClient;

const swallow = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

function ExampleFigure({
  label,
  caption,
  testId,
  children,
}: {
  /** The figure's accessible name: what the picture shows. */
  label: string;
  caption: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <figure aria-label={label} className="my-3 max-w-2xl" data-testid={testId}>
      <div className="mb-1 text-3xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        Example
      </div>
      <div
        inert
        aria-hidden="true"
        className="pointer-events-none overflow-hidden rounded-lg border border-dashed border-border bg-background select-none"
        data-testid={`${testId}-picture`}
        onClickCapture={swallow}
        onPointerDownCapture={swallow}
        onKeyDownCapture={swallow}
        onChangeCapture={swallow}
        onSubmitCapture={swallow}
      >
        <ClientProvider client={exampleClient}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </ClientProvider>
      </div>
      <figcaption className="mt-1.5 text-2xs leading-relaxed text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}

/** The strip at the top of a PM or session page: off, and on with Running and its link. */
export function DevPreviewSwitchExample() {
  return (
    <ExampleFigure
      testId="dev-servers-example-switch"
      label="Example: the Dev preview switch at the top of a PM or session page, off, and on with the status Running and the link http://localhost:43100"
      caption={
        <>
          An example, not a control. The strip at the top of a PM or session page: first with the
          switch off, then switched on, with the status <b>Running</b> and the preview's link.
        </>
      }
    >
      <DevPreviewPmBar projectId={OFF} />
      <DevPreviewPmBar projectId={ON} />
    </ExampleFigure>
  );
}

/** The project's Settings › Dev preview section, with a dev and a prepare command filled in. */
export function DevPreviewSettingsExample() {
  return (
    <ExampleFigure
      testId="dev-servers-example-settings"
      label="Example: a project's Settings, Dev preview section, with the dev command pnpm dev and the prepare command pnpm install --frozen-lockfile"
      caption={
        <>
          An example, not a form. A project's <b>Settings</b> › <b>Dev preview</b>: the dev command
          (<code>pnpm dev</code>) and the prepare command (
          <code>pnpm install --frozen-lockfile</code>) are typed there.
        </>
      }
    >
      <div className="p-3">
        {/* The section reads the project's id and nothing else. */}
        <DevPreviewProjectSettings project={{ id: SETTINGS_OF } as Project} />
      </div>
    </ExampleFigure>
  );
}
