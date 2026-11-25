export const DEFAULT_PACKAGE_NAME: string;
export const DEFAULT_RELEASE_REPOSITORY: string;
export const DEFAULT_HARDEN_BRANCH: string;
export const DEFAULT_PRODUCT_NAME: string;
export const DEFAULT_APP_ID: string;
export const DEFAULT_APP_SLUG: string;
export const DEFAULT_PORT: number;
export const DEFAULT_TEMPLATE_REPOSITORY: string;
export const DEFAULT_TEMPLATE_BRANCH: string;

/** The identity's word for a package: its command in lower-case letters and digits. */
export function slugOfPackage(packageName: string): string;

export interface HardenChannelOptions {
  /** The checkout's `owner/repo`; default: read from the `origin` remote. `null`: none. */
  origin?: string | null;
  /**
   * Packing a release: throw instead of using CodeHarden's names in another repository.
   * Default: what the environment says (`isReleasePack`).
   */
  strict?: boolean;
  /** Don't print the warning an ordinary build gives in another repository. */
  quiet?: boolean;
}

/** The variable that says a release is being packed: `HARDEN_RELEASE_PACK`. */
export const RELEASE_PACK_VARIABLE: string;

/** Whether `env` says a release is being packed (`1`); throws on anything but `1`, `0` or unset. */
export function isReleasePack(env?: Record<string, string | undefined>): boolean;

/** The `owner/repo` of a github.com remote URL, or null. */
export function repositoryOfRemote(url: string | null | undefined): string | null;

/** The `owner/repo` of this checkout's `origin` remote, or null. */
export function originRepository(): string | null;

/**
 * The update channel and the identity for this build, from `PACKAGE_NAME`, `RELEASE_REPOSITORY`
 * and `HARDEN_BRANCH` (and the optional `PRODUCT_NAME`, `APP_ID`, `DEFAULT_PORT`) or the defaults.
 */
export function readHardenChannel(
  env?: Record<string, string | undefined>,
  options?: HardenChannelOptions,
): {
  packageName: string;
  repository: string;
  owner: string;
  repo: string;
  branch: string;
  /** The app's name (`CodeHarden`). */
  productName: string;
  /** The desktop app's id (`com.codeharden.app`). */
  appId: string;
  /** The home folder, link scheme, keychain service and executable are named after it. */
  slug: string;
  /** The default port. */
  port: number;
  /** The Secure Foundation template's `owner/repo`; "" when the option is off. */
  templateRepository: string;
  /** The template's branch. */
  templateBranch: string;
};

/** The bundler `define` entries that inject it. */
export function hardenChannelDefine(
  env?: Record<string, string | undefined>,
  options?: HardenChannelOptions,
): {
  __CODEHARDEN_PACKAGE__: string;
  __CODEHARDEN_REPOSITORY__: string;
  __CODEHARDEN_BRANCH__: string;
  __CODEHARDEN_PRODUCT__: string;
  __CODEHARDEN_APP_ID__: string;
  __CODEHARDEN_SLUG__: string;
  __CODEHARDEN_PORT__: string;
  __CODEHARDEN_TEMPLATE_REPOSITORY__: string;
  __CODEHARDEN_TEMPLATE_BRANCH__: string;
};
