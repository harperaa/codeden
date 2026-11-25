// The build-time injection of the CodeHarden version. The root `VERSION` file is read here and
// nowhere else in the build: the tsdown configs (CLI, desktop) and the web app's Vite config
// spread `hardenVersionDefine()` into their `define`, and
// `packages/contracts/src/harden-version.ts` is the one module that reads the constant.
import { readFileSync } from "node:fs";

const VERSION_FILE = new URL("../../VERSION", import.meta.url);

/** `YYYY.MMDD.HHMM`, zeros kept. */
const PATTERN = /^\d{4}\.\d{4}\.\d{4}$/;

/** The CodeHarden version in `VERSION`; throws when the file is missing or malformed. */
export function readHardenVersion(file = VERSION_FILE) {
  const version = readFileSync(file, "utf8").trim();
  if (!PATTERN.test(version)) {
    throw new Error(
      `VERSION must be YYYY.MMDD.HHMM (for example 2026.0105.0518), found "${version}"`,
    );
  }
  return version;
}

/** The `define` entry for a bundler: `{ __CODEHARDEN_VERSION__: '"2026.0105.0518"' }`. */
export function hardenVersionDefine(file = VERSION_FILE) {
  return { __CODEHARDEN_VERSION__: JSON.stringify(readHardenVersion(file)) };
}
