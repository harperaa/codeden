// The build-time injection of CodeHarden's update channel: the npm package self-update installs,
// the GitHub repository whose releases the desktop app and the release links use, and the
// branch the docs and changelog links point at. The tsdown configs (CLI, desktop) and the web
// app's Vite config spread `hardenChannelDefine()` into their `define`, the desktop packaging
// reads `readHardenChannel()` for its publish target, and
// `packages/contracts/src/harden-channel.ts` is the one module that reads the constants (and
// holds the same defaults for the workspace, tests and `pnpm dev`).
//
// Build variables (nothing reads them at runtime). A fork keeps the first and the third as
// repository variables (scripts/harden/setup-fork.sh); scripts/harden/publish.sh passes all
// three to the build:
//   PACKAGE_NAME        the npm package, default `codeharden`
//   RELEASE_REPOSITORY  the GitHub `owner/repo`; default: the `origin` remote of this checkout
//                       when it is a GitHub repository, else `harperaa/codeharden`
//   HARDEN_BRANCH       the fork's working branch, default `harden`
//
// The same module gives the install's identity: what tells this product apart from upstream
// CodeDen and from other forks on one machine. It is derived from the package name, so a fork
// that set PACKAGE_NAME already has its own; three optional variables name it exactly:
//   PRODUCT_NAME        the app's name, default: the package's command (`CodeHarden` for
//                       `codeharden`)
//   APP_ID              the desktop app's id, default `com.<word>.app`
//   DEFAULT_PORT        the port the CLI and the app listen on, default 4417
// The "Secure Foundation" option of the add-project dialog installs one template repository:
//   TEMPLATE_REPOSITORY the template's GitHub `owner/repo`, default
//                       `harperaa/secure-vibe-coding-OS`; `none` switches the option off (an
//                       empty value is an unset one, as for every variable here)
//   TEMPLATE_BRANCH     the branch whose latest commit is installed, default `main`
// `<word>` (`slug`) is the command in lower-case letters and digits. It names the home folder
// (`~/.<word>`), the link scheme (`<word>://`), the keychain service, the Linux executable
// and the desktop package.
//
// CodeHarden's package name is the default only for CodeHarden. In a checkout whose `origin` is
// another repository an ordinary build warns and goes on (development, CI, tests); packing a
// release (`strict`) refuses, so a fork can't publish, or update its users, as `codeharden`.
// Two things pack a release: the npm release (scripts/harden/npm-release.mjs passes `strict`)
// and the desktop installers. For the second there is one signal, read here and nowhere else:
//   HARDEN_RELEASE_PACK `1` makes every read of the channel in that process strict; unset, empty
//                       or `0` leaves it an ordinary build
// apps/desktop/scripts/package.mjs sets it whenever it builds installers (every run without
// `--dir`: `pnpm desktop:dist` and the "Desktop installers" workflow, its dry run included),
// before it reads the channel and loads electron-builder.config.mjs, so the two can't differ.
// `pnpm desktop:build`, `pnpm desktop:dev` and the tests never set it. Set it yourself to make
// another step strict too (`HARDEN_RELEASE_PACK=1 pnpm build`).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_PACKAGE_NAME = "codeharden";
export const DEFAULT_RELEASE_REPOSITORY = "harperaa/codeharden";
export const DEFAULT_HARDEN_BRANCH = "harden";
export const DEFAULT_PRODUCT_NAME = "CodeHarden";
export const DEFAULT_APP_ID = "com.codeharden.app";
export const DEFAULT_APP_SLUG = "codeharden";
export const DEFAULT_PORT = 4417;
export const DEFAULT_TEMPLATE_REPOSITORY = "harperaa/secure-vibe-coding-OS";
export const DEFAULT_TEMPLATE_BRANCH = "main";

const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const BAD_BRANCH = /\.\.|\/\/|\/$|\.$|\.lock$|\/\./;
const PRODUCT = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
const APP_ID = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
const SLUG = /^[a-z][a-z0-9]{0,39}$/;
const GITHUB_REMOTE =
  /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/|git:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/;

/** The `owner/repo` of a github.com remote URL, or null for anything else. */
export function repositoryOfRemote(url) {
  const repository = GITHUB_REMOTE.exec(String(url ?? "").trim())?.[1];
  return repository && REPOSITORY.test(repository) && !/\/\.{1,2}$/.test(repository)
    ? repository
    : null;
}

let cachedOrigin;
/** The `owner/repo` of this checkout's `origin` remote, or null (no git, no origin, not GitHub). */
export function originRepository() {
  if (cachedOrigin !== undefined) return cachedOrigin;
  // Git's own variables (set while a hook runs) must not point this at another repository.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    encoding: "utf8",
    env,
  });
  cachedOrigin = result.status === 0 ? repositoryOfRemote(result.stdout) : null;
  return cachedOrigin;
}

/** The identity's word for a package: its command in lower-case letters and digits. */
export function slugOfPackage(packageName) {
  const command = packageName.slice(packageName.lastIndexOf("/") + 1);
  const word = command.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (/^[a-z]/.test(word) ? word : `app${word}`).slice(0, 40);
}

/** The identity of a build of `packageName`; throws when a variable is malformed. */
function readIdentity(env, packageName) {
  const slug = slugOfPackage(packageName);
  const own = packageName === DEFAULT_PACKAGE_NAME;
  const productName =
    env.PRODUCT_NAME?.trim() ||
    (own ? DEFAULT_PRODUCT_NAME : packageName.slice(packageName.lastIndexOf("/") + 1));
  const appId = env.APP_ID?.trim() || `com.${slug}.app`;
  const portText = env.DEFAULT_PORT?.trim();
  const port = portText ? Number(portText) : DEFAULT_PORT;
  if (!SLUG.test(slug)) {
    throw new Error(`PACKAGE_NAME "${packageName}" gives no usable app name ("${slug}")`);
  }
  if (!PRODUCT.test(productName)) {
    throw new Error(
      `PRODUCT_NAME must be letters, digits, spaces, dots and dashes (40 at most), found "${productName}"`,
    );
  }
  if (!APP_ID.test(appId)) {
    throw new Error(`APP_ID must look like com.example.app, found "${appId}"`);
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`DEFAULT_PORT must be a port from 1024 to 65535, found "${portText}"`);
  }
  return { productName, appId, slug, port };
}

/** The Secure Foundation template of a build; `repository` is "" when the option is off. */
function readTemplate(env) {
  const raw = env.TEMPLATE_REPOSITORY?.trim() ?? "";
  const repository = raw.toLowerCase() === "none" ? "" : raw || DEFAULT_TEMPLATE_REPOSITORY;
  const branch = env.TEMPLATE_BRANCH?.trim() || DEFAULT_TEMPLATE_BRANCH;
  if (repository && (!REPOSITORY.test(repository) || /\/\.{1,2}$/.test(repository))) {
    throw new Error(
      `TEMPLATE_REPOSITORY must be a GitHub owner/repo (or "none"), found "${repository}"`,
    );
  }
  if (!BRANCH.test(branch) || BAD_BRANCH.test(branch)) {
    throw new Error(`TEMPLATE_BRANCH must be a branch name, found "${branch}"`);
  }
  return { templateRepository: repository, templateBranch: branch };
}

/** The variable that says a release is being packed (the desktop packaging sets it). */
export const RELEASE_PACK_VARIABLE = "HARDEN_RELEASE_PACK";

/** Whether `env` says a release is being packed; throws on a value that is neither yes nor no. */
export function isReleasePack(env = process.env) {
  const value = env[RELEASE_PACK_VARIABLE]?.trim() ?? "";
  if (value === "" || value === "0") return false;
  if (value === "1") return true;
  // A misspelt "yes" must not quietly be an ordinary build.
  throw new Error(`${RELEASE_PACK_VARIABLE} must be 1, 0 or unset, found "${value}"`);
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();
let warned = false;

/**
 * The channel for this build; throws when a variable is set to something malformed.
 * `origin` is the checkout's `owner/repo` (tests pass it); `strict` is for packing a release:
 * it throws instead of building another repository's release with CodeHarden's names. Left
 * out, it is what `env` says (`HARDEN_RELEASE_PACK`, see the top of this file).
 */
export function readHardenChannel(env = process.env, options = {}) {
  const origin = options.origin === undefined ? originRepository() : options.origin;
  const strict = options.strict === undefined ? isReleasePack(env) : Boolean(options.strict);
  const foreign = origin ? !same(origin, DEFAULT_RELEASE_REPOSITORY) : strict;
  const where = origin
    ? `this checkout's origin is ${origin}`
    : "this checkout has no GitHub origin";

  let packageName = env.PACKAGE_NAME?.trim();
  if (!packageName) {
    if (foreign && strict) {
      throw new Error(
        `PACKAGE_NAME is not set, and ${where}, not ${DEFAULT_RELEASE_REPOSITORY}: refusing to pack a release as "${DEFAULT_PACKAGE_NAME}". Set PACKAGE_NAME to this fork's own npm package (scripts/harden/setup-fork.sh creates the repository variable).`,
      );
    }
    if (foreign && !warned && !options.quiet) {
      warned = true;
      console.warn(
        `[codeharden] PACKAGE_NAME is not set and ${where}: this build uses CodeHarden's package name "${DEFAULT_PACKAGE_NAME}" for self-update. Fine for development; set PACKAGE_NAME for a build you hand to users.`,
      );
    }
    packageName = DEFAULT_PACKAGE_NAME;
  }
  // GitHub names are case-insensitive: CodeHarden's own is always written one way.
  const ownOrigin = origin && !foreign ? DEFAULT_RELEASE_REPOSITORY : origin;
  let repository = env.RELEASE_REPOSITORY?.trim() || ownOrigin;
  if (!repository) {
    if (strict && !same(packageName, DEFAULT_PACKAGE_NAME)) {
      throw new Error(
        `RELEASE_REPOSITORY is not set and ${where}: refusing to pack "${packageName}" with links to ${DEFAULT_RELEASE_REPOSITORY}. Set RELEASE_REPOSITORY to this fork's owner/repo.`,
      );
    }
    repository = DEFAULT_RELEASE_REPOSITORY;
  }
  const branch = env.HARDEN_BRANCH?.trim() || DEFAULT_HARDEN_BRANCH;
  if (!PACKAGE.test(packageName)) {
    throw new Error(`PACKAGE_NAME must be an npm package name, found "${packageName}"`);
  }
  if (!REPOSITORY.test(repository)) {
    throw new Error(`RELEASE_REPOSITORY must be a GitHub owner/repo, found "${repository}"`);
  }
  if (!BRANCH.test(branch) || BAD_BRANCH.test(branch)) {
    throw new Error(`HARDEN_BRANCH must be a branch name, found "${branch}"`);
  }
  const [owner, repo] = repository.split("/");
  return {
    packageName,
    repository,
    owner,
    repo,
    branch,
    ...readIdentity(env, packageName),
    ...readTemplate(env),
  };
}

/** The `define` entries for a bundler. */
export function hardenChannelDefine(env = process.env, options = {}) {
  const channel = readHardenChannel(env, options);
  const { packageName, repository, branch } = channel;
  return {
    __CODEHARDEN_PACKAGE__: JSON.stringify(packageName),
    __CODEHARDEN_REPOSITORY__: JSON.stringify(repository),
    __CODEHARDEN_BRANCH__: JSON.stringify(branch),
    __CODEHARDEN_PRODUCT__: JSON.stringify(channel.productName),
    __CODEHARDEN_APP_ID__: JSON.stringify(channel.appId),
    __CODEHARDEN_SLUG__: JSON.stringify(channel.slug),
    __CODEHARDEN_PORT__: JSON.stringify(channel.port),
    __CODEHARDEN_TEMPLATE_REPOSITORY__: JSON.stringify(channel.templateRepository),
    __CODEHARDEN_TEMPLATE_BRANCH__: JSON.stringify(channel.templateBranch),
  };
}
