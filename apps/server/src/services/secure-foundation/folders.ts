import { lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** What Secure Foundation reads and removes on disk, apart from git. */

/** The Clerk claim link in the install's summary: a line `Visit: https://…clerk.com/…`. */
export function claimLink(summary: string): string | null {
  for (const line of summary.split("\n")) {
    if (!line.startsWith("Visit:")) continue;
    const text = line.slice("Visit:".length).trim();
    if (text.length > 2_000 || text.includes(" ")) continue;
    try {
      const url = new URL(text);
      const host = url.hostname.toLowerCase();
      const clerk = ["clerk.com", "clerk.dev"].some((d) => host === d || host.endsWith(`.${d}`));
      if (url.protocol === "https:" && clerk) return text;
    } catch {
      // Not a link.
    }
  }
  return null;
}

/** The deployed site in the deploy summary: the first link on a vercel.app address. */
export function deployedLink(summary: string): string | null {
  for (const word of summary.split(/\s/)) {
    const at = word.indexOf("https://");
    if (at < 0 || word.length > 2_000) continue;
    let text = word.slice(at);
    while (/[.,)*`>\]]$/.test(text)) text = text.slice(0, -1);
    try {
      const url = new URL(text);
      if (url.hostname.toLowerCase().endsWith(".vercel.app")) return url.origin;
    } catch {
      // Not a link.
    }
  }
  return null;
}

/**
 * True when `dest` is a real folder that sits directly in its parent: not a link, and not
 * reached through one. Only such a folder is written to, or cleaned up.
 */
export function isOwnFolder(dest: string): boolean {
  try {
    if (!lstatSync(dest).isDirectory()) return false;
    return realpathSync(dest) === join(realpathSync(dirname(dest)), basename(dest));
  } catch {
    return false;
  }
}

/**
 * Remove what a failed create wrote: the folder, or only its contents when it was there before.
 * Nothing is removed unless `dest` is still a folder of its own: a link put in its place is
 * left alone, and so is whatever it points at.
 */
export function removeCreated(dest: string, existed: boolean): void {
  try {
    if (!isOwnFolder(dest)) return;
    if (!existed) {
      rmSync(dest, { recursive: true, force: true });
      return;
    }
    for (const entry of readdirSync(dest)) {
      rmSync(join(dest, entry), { recursive: true, force: true });
    }
  } catch {
    // Best effort: the error that brought us here is the one to report.
  }
}
