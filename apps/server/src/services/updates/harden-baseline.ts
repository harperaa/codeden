import {
  HARDEN_VERSION,
  HARDEN_VERSION_PATTERN,
  hardenNpmVersion,
  hardenVersionOf,
  type InstallSource,
} from "@codeden/contracts";

/**
 * The version the registry's latest is compared with to decide "an update is available".
 *
 * A published build and the desktop app compare with their own package version (`current`),
 * which the release wrote into the package: nothing changes for them.
 *
 * A source build's package version is upstream's (`0.7.7`): the repository keeps it on purpose
 * and the CodeHarden version is only written into the package at pack time. Compared with that,
 * every CodeHarden release on npm looks newer, including ones older than the checkout. So a
 * source build compares with the CodeHarden version it was made from (the root `VERSION` file,
 * `HARDEN_VERSION`) in its npm form.
 *
 * It falls back to `current` when that version is unknown, or when the registry's version is
 * not a CodeHarden version (then the two are not the same kind of number), so an update is
 * never hidden for lack of something to compare with.
 */
export function hardenUpdateBaseline(
  source: InstallSource,
  current: string,
  latest: string,
  hardenVersion: string = HARDEN_VERSION,
): string {
  if (source !== "source") return current;
  if (!HARDEN_VERSION_PATTERN.test(hardenVersion)) return current;
  if (!HARDEN_VERSION_PATTERN.test(hardenVersionOf(latest))) return current;
  return hardenNpmVersion(hardenVersion);
}
