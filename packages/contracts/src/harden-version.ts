import { HARDEN_PRODUCT_NAME } from "./harden-channel";
import { SOURCE_VERSION } from "./version";

/**
 * The versions CodeHarden shows to people, and the one line that shows them. Every display
 * (CLI, doctor, the server's version API, the web UI, the desktop app) reads from here; nothing
 * else reads the root `VERSION` file or repeats the format.
 *
 * These are for display only. The update check, the runner handshake, user agents and protocol
 * fields keep using `CODEDEN_VERSION` (the package version), which in a published CodeHarden
 * build is neither of the two values below.
 */

/** Replaced at build time with the root `VERSION` file's content (`scripts/harden/version-define.mjs`). */
declare const __CODEHARDEN_VERSION__: string | undefined;

/** Shape of a CodeHarden version: `YYYY.MMDD.HHMM`, zeros kept (`2026.0105.0518`). */
export const HARDEN_VERSION_PATTERN = /^\d{4}\.\d{4}\.\d{4}$/;

/** Shown when the version was neither injected nor readable from the checkout. */
export const HARDEN_VERSION_UNKNOWN = "unknown";

/**
 * The CodeHarden version, `YYYY.MMDD.HHMM` with its zeros (never the npm form of it). Bundles
 * get it from the build-time define; in the workspace, tests and `pnpm dev`, where nothing is
 * injected, it is read from the root `VERSION` file.
 */
export const HARDEN_VERSION: string =
  injectedVersion() ?? checkoutVersion() ?? HARDEN_VERSION_UNKNOWN;

/**
 * The upstream CodeDen version this build is based on. Always the compiled-in `SOURCE_VERSION`,
 * never the package version: a published CodeHarden package carries its own version.
 */
export const UPSTREAM_VERSION: string = SOURCE_VERSION;

/** The two versions, as the server's version API returns them. */
export interface HardenVersions {
  hardenVersion?: string | undefined;
  upstreamVersion?: string | undefined;
}

/**
 * The version line shown everywhere: `CodeHarden 2026.1122.2006 · CodeDen 0.7.7 (upstream)`.
 * Without an argument it describes this build; the web UI passes what the server reported, and
 * a missing field falls back to this build's value.
 */
export function formatHardenVersion(versions: HardenVersions = {}): string {
  const harden = versions.hardenVersion ?? HARDEN_VERSION;
  const upstream = versions.upstreamVersion ?? UPSTREAM_VERSION;
  return `${HARDEN_PRODUCT_NAME} ${harden} · CodeDen ${upstream} (upstream)`;
}

function injectedVersion(): string | undefined {
  return typeof __CODEHARDEN_VERSION__ === "string" ? valid(__CODEHARDEN_VERSION__) : undefined;
}

/**
 * Reads `VERSION` at the repository root, three folders above this file. Node only, and without
 * a static `node:` import so the module still loads in the browser bundle (which always has the
 * define, so this never runs there).
 */
function checkoutVersion(): string | undefined {
  try {
    const node = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
      .process;
    const fs = node?.getBuiltinModule?.("node:fs") as
      | { readFileSync(path: string, encoding: "utf8"): string }
      | undefined;
    const url = node?.getBuiltinModule?.("node:url") as
      | { fileURLToPath(url: URL): string }
      | undefined;
    if (!fs || !url) return undefined;
    const file = url.fileURLToPath(new URL("../../../VERSION", import.meta.url));
    return valid(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function valid(value: string): string | undefined {
  const version = value.trim();
  return HARDEN_VERSION_PATTERN.test(version) ? version : undefined;
}
