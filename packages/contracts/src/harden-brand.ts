/**
 * The brand as people see it: the wordmark (the product name in two parts, the second in the
 * brand red) and where the web app's own icons are served. The mark's shapes and the colours
 * are in `harden-mark.ts`, which `scripts/harden/brand/make.mjs` writes from the one SVG source.
 */
import { HARDEN_PRODUCT_NAME } from "./harden-channel";
import { HARDEN_BRAND_RED, HARDEN_BRAND_RED_ON_DARK } from "./harden-mark";

/** The first part of a product name that is written in two colours. */
const WORDMARK_LEAD = "Code";

/** A product name as the wordmark shows it: `lead` in the text colour, `accent` in the red. */
export interface HardenWordmark {
  lead: string;
  accent: string;
}

/**
 * The wordmark's two parts: `Code` + `Harden`. A product whose name doesn't start with `Code`
 * (or is only that) is written whole in the text colour: `accent` is then empty.
 */
export function hardenWordmark(name: string = HARDEN_PRODUCT_NAME): HardenWordmark {
  if (name.startsWith(WORDMARK_LEAD) && name.length > WORDMARK_LEAD.length) {
    return { lead: WORDMARK_LEAD, accent: name.slice(WORDMARK_LEAD.length) };
  }
  return { lead: name, accent: "" };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * The wordmark as HTML, for the pages the server writes itself (no stylesheet of the app
 * there): the accent in the red that reads on a `light` or a `dark` ground.
 */
export function hardenWordmarkHtml(ground: "light" | "dark", name?: string): string {
  const { lead, accent } = hardenWordmark(name);
  if (!accent) return escapeHtml(lead);
  const color = ground === "dark" ? HARDEN_BRAND_RED_ON_DARK : HARDEN_BRAND_RED;
  return `${escapeHtml(lead)}<span style="color:${color}">${escapeHtml(accent)}</span>`;
}

/** The folder of the web app's own icons, in its public folder and in the URL. */
const ICONS = "/harden";

/** The tab icon (also the icon of browser notifications). */
export const HARDEN_FAVICON_PATH = `${ICONS}/favicon.svg`;

/**
 * Upstream's icon paths in `index.html` and the web manifest, and this product's icon served
 * in each one's place. The web build rewrites the first to the second
 * (`scripts/harden/web-identity.mjs`, which a test keeps equal to this list).
 */
export const HARDEN_WEB_ICONS: Readonly<Record<string, string>> = {
  "/favicon.svg": HARDEN_FAVICON_PATH,
  "/apple-touch-icon.png": `${ICONS}/apple-touch-icon.png`,
  "/icons/icon-192.png": `${ICONS}/icon-192.png`,
  "/icons/icon-512.png": `${ICONS}/icon-512.png`,
  "/icons/maskable-192.png": `${ICONS}/maskable-192.png`,
  "/icons/maskable-512.png": `${ICONS}/maskable-512.png`,
};

/** The icon files a browser fetches without cookies (a tab, an installed web app). */
export const HARDEN_PUBLIC_ICON_PATHS: readonly string[] = Object.values(HARDEN_WEB_ICONS);
