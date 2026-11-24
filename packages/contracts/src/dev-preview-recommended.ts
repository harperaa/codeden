import type { DevPreviewRecommended, DevPreviewSettings } from "./dev-preview";
import { HARDEN_PRODUCT_NAME } from "./harden-channel";

/**
 * The dev preview of this product's own repository (`docs/dev-preview.md`, "This repository"):
 * the values the settings form is filled with when the project is a checkout of it.
 *
 * Everything here is a constant of the app. The repository is only looked at to decide whether
 * to offer them (the server checks that the script below exists in a checkout whose root package
 * is this workspace's); no text from the repository becomes part of a command. And they are a
 * suggestion for a form: a command is stored only when a person confirms it in the settings on
 * this computer.
 */

/** The repository's own dev command for a preview, relative to the checkout. */
export const HARDEN_DEV_PREVIEW_SCRIPT = "scripts/harden/dev-preview/run.mjs";

/** The name of the workspace's root package, which a checkout of this repository has. */
export const HARDEN_WORKSPACE_PACKAGE = "codeden-monorepo";

/**
 * How a line starts that the script prints when a port variable is missing
 * (`dev-preview: set API_PORT to a free port (1024-65535).`). A failed preview whose log has
 * such a line points to the settings.
 */
export const HARDEN_DEV_PREVIEW_PORT_ERROR = "dev-preview: set ";

/** The settings that work for a checkout of this repository. A new object each time. */
export function hardenDevPreviewSettings(): DevPreviewSettings {
  return {
    command: `node ${HARDEN_DEV_PREVIEW_SCRIPT}`,
    // A preview's folder is a fresh checkout: it has no `node_modules`.
    prepareCommand: "pnpm install --frozen-lockfile",
    // The web app, which the link opens, then the server behind it.
    portVars: ["WEB_PORT", "API_PORT"],
    urlFrom: "port",
    urlPattern: null,
    pmEnabled: true,
  };
}

/** What the server offers for a project that is a checkout of this repository. */
export function hardenDevPreviewRecommended(): DevPreviewRecommended {
  return { settings: hardenDevPreviewSettings(), reason: `A ${HARDEN_PRODUCT_NAME} checkout` };
}

/**
 * Stored settings that run the recommended dev command without the port variables it reads, in
 * the order it needs them (the first is the page the link opens). Such a preview fails at once.
 * False for any other dev command: what a person typed for their own command is theirs.
 */
export function devPreviewNeedsRecommendedPorts(
  stored: Pick<DevPreviewSettings, "command" | "portVars">,
  recommended: Pick<DevPreviewSettings, "command" | "portVars">,
): boolean {
  if (stored.command.trim() !== recommended.command) return false;
  return !recommended.portVars.every((name, index) => stored.portVars[index] === name);
}
