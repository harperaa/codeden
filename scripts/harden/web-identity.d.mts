import type { HardenChannelOptions } from "./channel-define.mjs";

/** The manifest's file name in the web app's public folder and in its build. */
export const MANIFEST_FILE: string;

/** `html` with the page title and the home-screen title set to `name`; throws when one is gone. */
export function titledHtml(html: string, name: string): string;

/** The web manifest `text` with `name` and `short_name` set to `name`. */
export function namedManifest(text: string, name: string): string;

/** Upstream's icon paths in the page and the manifest, and this product's icon for each. */
export const HARDEN_ICONS: Readonly<Record<string, string>>;

/** `html` with its tab icon and apple-touch icon pointing at this product's own. */
export function brandedHtml(html: string): string;

/** The web manifest `text` with every icon replaced by this product's own. */
export function brandedManifest(text: string): string;

/** The Vite plugin that names the page and the web manifest after this build's product. */
export function hardenWebIdentity(
  env?: Record<string, string | undefined>,
  options?: HardenChannelOptions,
): { name: string; transformIndexHtml(html: string): string; [hook: string]: unknown };
