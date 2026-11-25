/** The CodeHarden version in the root `VERSION` file; throws when it is missing or malformed. */
export function readHardenVersion(file?: string | URL): string;

/** The bundler `define` entry that injects it as `__CODEHARDEN_VERSION__`. */
export function hardenVersionDefine(file?: string | URL): { __CODEHARDEN_VERSION__: string };
