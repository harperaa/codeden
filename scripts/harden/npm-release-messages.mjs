// What the npm release says about signing in and about a publish that failed
// (scripts/harden/npm-release.mjs). Text only, so it can be tested without npm.

export const NPM_REGISTRY = "https://registry.npmjs.org";

/** `--registry <url>` for a command a person copies, or nothing for the public registry. */
function registryFlag(registry) {
  return registry === NPM_REGISTRY ? "" : ` --registry ${registry}`;
}

/** The command that signs in to a registry, in the browser. */
export function loginCommand(registry = NPM_REGISTRY) {
  return `node scripts/harden/npm-release.mjs login${registryFlag(registry)}`;
}

/** Why a publish refuses when `npm whoami` shows nobody, and the fix, in one line. */
export function notSignedInMessage(registry = NPM_REGISTRY) {
  return `npm is not signed in to ${registry} (npm whoami shows nobody). Sign in, then publish again: ${loginCommand(registry)}`;
}

/** What `login` says before npm takes the terminal. */
export function loginIntro(registry = NPM_REGISTRY) {
  return [
    `Signing in to ${registry} in the browser. npm prints a URL ("Login at:"): open it and approve there.`,
    "If npm asks for a username, a password or a one-time code here instead, stop it (Ctrl-C):",
    "the web sign-in is not available, and nothing secret is typed into this command. Run `npm login` yourself.",
  ].join("\n");
}

/** What `login` says once npm has a sign-in. */
export function signedInMessage(user, registry = NPM_REGISTRY) {
  return [
    `Signed in to ${registry} as ${user}.`,
    "npm stays signed in on this computer (the sign-in is in your user npm config) until you sign out:",
    `  npm logout${registryFlag(registry)}`,
  ].join("\n");
}

/**
 * What to say when `npm publish` failed. npm ran attached to the terminal, so its output is not
 * read here: the caller asks the registry again who is signed in (`user`) and whether the version
 * is there (`published`).
 *
 * A publish the registry can't authorise fails with E404, not E401 (an expired or revoked
 * sign-in, or an account without publish rights on the package). With no sign-in stored at all
 * npm stops by itself with ENEEDAUTH; `publish` refuses before that.
 */
export function publishFailureMessage({
  packageName,
  version,
  registry = NPM_REGISTRY,
  user,
  published,
}) {
  const spec = `${packageName}@${version}`;
  const login = loginCommand(registry);
  if (published) {
    return `npm publish reported a failure, but the registry lists ${spec}: it is published. Don't publish it again; check it with: npm view ${packageName} versions`;
  }
  const lines = [`npm publish failed. The registry does not list ${spec}: nothing was published.`];
  if (!user) {
    lines.push(
      `npm whoami now shows nobody for ${registry}: the sign-in expired or was removed (or the registry can't be reached). If npm said E404, that is why.`,
      `Sign in, then publish the same version again: ${login}`,
    );
    return lines.join("\n");
  }
  lines.push(
    'If npm said E404 ("Not Found - PUT ...", "is not in this registry" or "you do not have permission',
    'to access it"): that is almost always about the sign-in, not the package. The registry answers',
    "404, not 401, to a publish it can't authorise. The tarball is fine and the same version can be",
    "published again.",
    `npm is signed in as ${user}. Either that sign-in can no longer publish (sign in again: ${login}),`,
    `or the account ${user} has no publish rights on ${packageName}: then stop, it is the wrong account.`,
  );
  return lines.join("\n");
}
