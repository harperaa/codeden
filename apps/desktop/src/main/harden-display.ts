import { formatHardenVersion, HARDEN_PRODUCT_NAME } from "@codeden/contracts";

/**
 * The page's own name, which its title ends with: bare, behind a waiting count
 * (`(2) CodeHarden`) or after the waiting cue. The web app takes it from the same constant.
 */
const PAGE_NAME = HARDEN_PRODUCT_NAME;

/**
 * The window title for a page title: the version line takes the place of the page's name, and
 * what the page puts before it (the waiting count) is kept. Any other title gets the line after
 * it.
 */
export function hardenWindowTitle(pageTitle: string): string {
  const line = formatHardenVersion();
  const title = pageTitle.trim();
  if (title.length === 0) return line;
  if (title.endsWith(PAGE_NAME)) return `${title.slice(0, -PAGE_NAME.length)}${line}`;
  return `${title} · ${line}`;
}

/** What the About panel shows (macOS: the app menu's About item). */
export function hardenAboutPanel(): { applicationName: string; applicationVersion: string } {
  return { applicationName: HARDEN_PRODUCT_NAME, applicationVersion: formatHardenVersion() };
}
