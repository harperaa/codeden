/**
 * CodeHarden's update channel: the npm package the self-update installs and the GitHub
 * repository whose releases the desktop app and every "releases" / "what's new" link use.
 * This is the one module that names them. The update check, the installer, the launcher, the
 * desktop packaging and the links all read from here, so an update can only ever fetch
 * CodeHarden, never upstream CodeDen.
 *
 * It also holds the install's identity: everything that tells this product apart from upstream
 * CodeDen (and from another fork) on one machine: the product name, the app id, the home
 * folder, the `codeharden://` link scheme, the keychain service and the default port. Two
 * products with different identities install and run side by side and share nothing.
 *
 * The values are fixed when a bundle is built (`scripts/harden/channel-define.mjs`, from the
 * `PACKAGE_NAME`, `RELEASE_REPOSITORY` and `HARDEN_BRANCH` build variables, and the optional
 * `PRODUCT_NAME`, `APP_ID` and `DEFAULT_PORT`, and `TEMPLATE_REPOSITORY` and `TEMPLATE_BRANCH`
 * for the Secure Foundation template) and default to CodeHarden's own.
 * There is no runtime override: a running install can't be pointed at another package or
 * repository by an environment variable or a setting.
 *
 * No imports, on purpose: the CLI launcher loads this module before the rest of the bundle.
 */

/** Replaced at build time with the npm package name (`scripts/harden/channel-define.mjs`). */
declare const __CODEHARDEN_PACKAGE__: string | undefined;
/** Replaced at build time with the GitHub `owner/repo` (`scripts/harden/channel-define.mjs`). */
declare const __CODEHARDEN_REPOSITORY__: string | undefined;

/** Replaced at build time with the fork's working branch (`scripts/harden/channel-define.mjs`). */
declare const __CODEHARDEN_BRANCH__: string | undefined;

/** Replaced at build time with the product name (`scripts/harden/channel-define.mjs`). */
declare const __CODEHARDEN_PRODUCT__: string | undefined;
/** Replaced at build time with the desktop app's id (`scripts/harden/channel-define.mjs`). */
declare const __CODEHARDEN_APP_ID__: string | undefined;
/** Replaced at build time with the identity's lower-case word (`scripts/harden/channel-define.mjs`). */
declare const __CODEHARDEN_SLUG__: string | undefined;
/** Replaced at build time with the default port (`scripts/harden/channel-define.mjs`). */
declare const __CODEHARDEN_PORT__: number | undefined;

/** Replaced at build time with the Secure Foundation template's `owner/repo`, or `""` for off. */
declare const __CODEHARDEN_TEMPLATE_REPOSITORY__: string | undefined;
/** Replaced at build time with the template's branch (`scripts/harden/channel-define.mjs`). */
declare const __CODEHARDEN_TEMPLATE_BRANCH__: string | undefined;

/** npm package names: `name` or `@scope/name`, lower case. */
export const HARDEN_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/** GitHub `owner/repo`. */
export const HARDEN_REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

/** A branch name, as it appears in a URL path. */
export const HARDEN_BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** The npm package self-update checks and installs. */
export const HARDEN_PACKAGE_NAME: string =
  (typeof __CODEHARDEN_PACKAGE__ === "string" && HARDEN_PACKAGE_PATTERN.test(__CODEHARDEN_PACKAGE__)
    ? __CODEHARDEN_PACKAGE__
    : undefined) ?? "codeharden";

/** The GitHub repository (`owner/repo`) that publishes CodeHarden's releases and holds its docs. */
export const HARDEN_REPOSITORY: string =
  (typeof __CODEHARDEN_REPOSITORY__ === "string" &&
  HARDEN_REPOSITORY_PATTERN.test(__CODEHARDEN_REPOSITORY__)
    ? __CODEHARDEN_REPOSITORY__
    : undefined) ?? "harperaa/codeharden";

/** The branch CodeHarden is developed and released from (docs and changelog links). */
export const HARDEN_BRANCH: string =
  (typeof __CODEHARDEN_BRANCH__ === "string" &&
  HARDEN_BRANCH_PATTERN.test(__CODEHARDEN_BRANCH__) &&
  !__CODEHARDEN_BRANCH__.includes("..")
    ? __CODEHARDEN_BRANCH__
    : undefined) ?? "harden";

/**
 * The GitHub repository (`owner/repo`) the "Secure Foundation" option of the add-project dialog
 * installs: a starter that a new project is created from (`secure-foundation.ts`). An empty
 * string switches the option off. Only this repository is ever fetched: no request names one.
 */
export const HARDEN_TEMPLATE_REPOSITORY: string =
  (typeof __CODEHARDEN_TEMPLATE_REPOSITORY__ === "string" &&
  (__CODEHARDEN_TEMPLATE_REPOSITORY__ === "" ||
    HARDEN_REPOSITORY_PATTERN.test(__CODEHARDEN_TEMPLATE_REPOSITORY__))
    ? __CODEHARDEN_TEMPLATE_REPOSITORY__
    : undefined) ?? "harperaa/secure-vibe-coding-OS";

/** The template's branch whose latest commit is installed (shown before anything is fetched). */
export const HARDEN_TEMPLATE_BRANCH: string =
  (typeof __CODEHARDEN_TEMPLATE_BRANCH__ === "string" &&
  HARDEN_BRANCH_PATTERN.test(__CODEHARDEN_TEMPLATE_BRANCH__) &&
  !__CODEHARDEN_TEMPLATE_BRANCH__.includes("..")
    ? __CODEHARDEN_TEMPLATE_BRANCH__
    : undefined) ?? "main";

/** The template's HTTPS clone URL, or null when the option is off. */
export function hardenTemplateUrl(): string | null {
  return HARDEN_TEMPLATE_REPOSITORY ? `https://github.com/${HARDEN_TEMPLATE_REPOSITORY}.git` : null;
}

/** A product name: letters, digits, spaces, dots, dashes; safe in a file name. */
export const HARDEN_PRODUCT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
/** A reverse-DNS app id (`com.codeharden.app`). */
export const HARDEN_APP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
/** The identity's word: lower-case letters and digits, starting with a letter (a URL scheme). */
export const HARDEN_SLUG_PATTERN = /^[a-z][a-z0-9]{0,39}$/;

/** The product's name: the app, its window and About, and the version line (`CodeHarden`). */
export const HARDEN_PRODUCT_NAME: string =
  (typeof __CODEHARDEN_PRODUCT__ === "string" && HARDEN_PRODUCT_PATTERN.test(__CODEHARDEN_PRODUCT__)
    ? __CODEHARDEN_PRODUCT__
    : undefined) ?? "CodeHarden";

/**
 * The desktop app's id: the macOS bundle id, the Windows AppUserModelId (notifications, taskbar,
 * the installer's uninstall entry) and electron-builder's `appId`.
 */
export const HARDEN_APP_ID: string =
  (typeof __CODEHARDEN_APP_ID__ === "string" && HARDEN_APP_ID_PATTERN.test(__CODEHARDEN_APP_ID__)
    ? __CODEHARDEN_APP_ID__
    : undefined) ?? "com.codeharden.app";

/** The identity's one lower-case word; the names below are made from it. */
export const HARDEN_APP_SLUG: string =
  (typeof __CODEHARDEN_SLUG__ === "string" && HARDEN_SLUG_PATTERN.test(__CODEHARDEN_SLUG__)
    ? __CODEHARDEN_SLUG__
    : undefined) ?? "codeharden";

/** The scheme of the links the desktop app opens: `codeharden://session/<id>`. */
export const HARDEN_DEEP_LINK_SCHEME: string = HARDEN_APP_SLUG;

/** The data folder's name in the user's home folder: `~/.codeharden`. */
export const HARDEN_HOME_DIRNAME = `.${HARDEN_APP_SLUG}`;

/** The default data folder as it is written for people: `~/.codeharden`. */
export const HARDEN_HOME_DISPLAY = `~/${HARDEN_HOME_DIRNAME}`;

/**
 * The folder in the user's home that repositories are cloned into unless a person picks another:
 * `~/codeharden-projects`. Only a default for new clones: a project keeps the path it has.
 */
export const HARDEN_PROJECTS_DIRNAME = `${HARDEN_APP_SLUG}-projects`;

/** The service name secrets are kept under in the OS keychain. */
export const HARDEN_KEYCHAIN_SERVICE: string = HARDEN_APP_SLUG;

/**
 * The port the CLI and the desktop app listen on by default. Upstream CodeDen uses 4317, so
 * both run at once without `--port`.
 */
export const HARDEN_DEFAULT_PORT: number =
  (typeof __CODEHARDEN_PORT__ === "number" &&
  Number.isInteger(__CODEHARDEN_PORT__) &&
  __CODEHARDEN_PORT__ >= 1024 &&
  __CODEHARDEN_PORT__ <= 65535
    ? __CODEHARDEN_PORT__
    : undefined) ?? 4417;

/** The home folder upstream CodeDen uses, and CodeHarden used before it had its own. */
export const UPSTREAM_HOME_DIRNAME = ".codeden";

/**
 * The one line said when the old home exists and this product's own doesn't yet: nothing is
 * moved or copied, and `--home` keeps using the old data.
 */
export function hardenHomeNotice(): string {
  return `${HARDEN_PRODUCT_NAME} now keeps its data in its own home, ${HARDEN_HOME_DISPLAY}, and starts empty there. To keep using the old one: ${HARDEN_COMMAND} --home ~/${UPSTREAM_HOME_DIRNAME}`;
}

/** The command the package installs: its name without the scope (`codeharden`). */
export const HARDEN_COMMAND: string = HARDEN_PACKAGE_NAME.slice(
  HARDEN_PACKAGE_NAME.lastIndexOf("/") + 1,
);

/** What to type to run the latest version once: `npx codeharden`. */
export const HARDEN_NPX_COMMAND = `npx ${HARDEN_PACKAGE_NAME}`;

/** The manual way to update a global install: `npm i -g codeharden@latest`. */
export const HARDEN_INSTALL_COMMAND = `npm i -g ${HARDEN_PACKAGE_NAME}@latest`;

/** The update command: `codeharden update`. */
export const HARDEN_UPDATE_COMMAND = `${HARDEN_COMMAND} update`;

/** The package's folder under `node_modules`, as path segments (two for a scoped name). */
export const HARDEN_PACKAGE_SEGMENTS: readonly string[] = HARDEN_PACKAGE_NAME.split("/");

/** An npm version made from a CodeHarden version: four digits, then two fields of one to four. */
const HARDEN_NPM_VERSION = /^(\d{4})\.(\d{1,4})\.(\d{1,4})$/;

/**
 * The npm form of a CodeHarden version: leading zeros stripped per field, as semver requires
 * (`2026.0105.0518` becomes `2026.105.518`). Anything else is returned unchanged.
 */
export function hardenNpmVersion(hardenVersion: string): string {
  const match = HARDEN_NPM_VERSION.exec(hardenVersion.trim().replace(/^v/, ""));
  if (!match) return hardenVersion;
  return `${match[1]}.${Number(match[2])}.${Number(match[3])}`;
}

/**
 * The CodeHarden version behind an npm version: the last two fields padded back to four digits
 * (`2026.105.518` becomes `2026.0105.0518`). A version of another shape (upstream semver, a
 * prerelease) is returned unchanged.
 */
export function hardenVersionOf(npmVersion: string): string {
  const match = HARDEN_NPM_VERSION.exec(npmVersion.trim().replace(/^v/, ""));
  if (!match) return npmVersion;
  const [, year, monthDay, time] = match as unknown as [string, string, string, string];
  return `${year}.${monthDay.padStart(4, "0")}.${time.padStart(4, "0")}`;
}

/** The git tag and GitHub release of a version: `v2026.0105.0518` for npm's `2026.105.518`. */
export function hardenReleaseTag(version: string): string {
  return `v${hardenVersionOf(version).replace(/^v/, "")}`;
}

const GITHUB = "https://github.com";

/** The repository's page on GitHub. */
export function hardenRepositoryUrl(): string {
  return `${GITHUB}/${HARDEN_REPOSITORY}`;
}

/** The release page of a version (npm or CodeHarden form). */
export function hardenReleaseUrl(version: string): string {
  return `${hardenRepositoryUrl()}/releases/tag/${encodeURIComponent(hardenReleaseTag(version))}`;
}

/** The GitHub API's JSON for a version's release (`{ body, html_url }`). */
export function hardenReleaseApiUrl(version: string): string {
  return `https://api.github.com/repos/${HARDEN_REPOSITORY}/releases/tags/${encodeURIComponent(hardenReleaseTag(version))}`;
}

/** The latest release, where the desktop installers are downloaded from. */
export function hardenLatestReleaseUrl(): string {
  return `${hardenRepositoryUrl()}/releases/latest`;
}

/** The raw CodeHarden changelog, whose sections are headed by CodeHarden versions. */
export function hardenChangelogUrl(): string {
  return `https://raw.githubusercontent.com/${HARDEN_REPOSITORY}/${HARDEN_BRANCH}/CODEHARDEN-CHANGELOG.md`;
}

/** A file in `docs/` as GitHub shows it (`desktop.md`); without a file, the folder with a trailing slash. */
export function hardenDocsUrl(file = ""): string {
  return `${hardenRepositoryUrl()}/blob/${HARDEN_BRANCH}/docs/${file}`;
}
