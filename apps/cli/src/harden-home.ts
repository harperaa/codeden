import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HARDEN_HOME_DIRNAME, hardenHomeNotice, UPSTREAM_HOME_DIRNAME } from "@codeden/contracts";

/**
 * The line to print when this start uses the product's own default home for the first time and
 * the home it shared with upstream CodeDen before is still there. Nothing is moved or copied:
 * the line only says where the data now lives and how to keep using the old folder. Null with
 * `--home` or `CODEDEN_HOME`, once the new home exists, and when there is no old home.
 *
 * Call it before the home is created.
 */
export function oldHomeNotice(
  home: string,
  userHome: string = homedir(),
  exists: (path: string) => boolean = existsSync,
): string | null {
  if (HARDEN_HOME_DIRNAME === UPSTREAM_HOME_DIRNAME) return null;
  if (home !== join(userHome, HARDEN_HOME_DIRNAME)) return null;
  if (exists(home) || !exists(join(userHome, UPSTREAM_HOME_DIRNAME))) return null;
  return hardenHomeNotice();
}
