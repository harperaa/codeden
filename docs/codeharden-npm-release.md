# Publishing CodeHarden to npm

CodeHarden is published to npm by hand, for the releases you choose. Not every CodeHarden release has to go to npm: installs update to the newest version npm has, and skip the ones in between.

The package is `codeharden`. The repository's `apps/cli/package.json` keeps upstream's name and version; `scripts/harden/publish.sh` (through `scripts/harden/npm-release.mjs`, which does the work) writes the release manifest into a staging folder at pack time (name, command, version, repository links) and changes nothing in the repository.

| | Example |
|---|---|
| CodeHarden version (`VERSION`, the git tag, the GitHub release) | `2026.0105.0518`, tag `v2026.0105.0518` |
| npm version (leading zeros stripped, as semver requires) | `2026.105.518` |

## Before the first publish

1. An npm account with two-factor authentication on (a security key or passkey if you can).
2. Node 24+ and pnpm 10 (`corepack enable`), and a clone of this repository.

## Every publish

1. **Cut the release**, if the changes you want aren't in one yet. On a clean, up-to-date `harden`:

   ```sh
   git checkout harden && git pull --ff-only
   scripts/harden/release.sh --dry-run   # shows the version, the tag and the changelog entry
   scripts/harden/release.sh --push      # commits, tags and pushes both in one atomic push
   ```

   It writes `VERSION` (the time now in America/New_York), a new entry on top of `CODEHARDEN-CHANGELOG.md` and `state/upstream-base`, in one commit `release: <version> (upstream <sha>)` tagged `v<version>`. Without `--push` it stays local and prints the push command. It refuses if the tag exists or tracked files have changes. The "Upstream sync merge" workflow runs the same script after it merges a sync, so a release may already be there.

   **The cooldown.** Before every release the script asks GitHub (it needs `gh`, signed in) about what was merged since the last one: whether the pull request that brought upstream commits in had waited its 48 hours when it was merged, and whether a pull request that was squashed or rebased carried any. If one had not waited, or if GitHub can't be asked, it refuses, changes nothing, and says which sync it is, from when it would have been allowed and what to enter in the waiver. `--dry-run` gives the same verdict. A sync that was merged early does not become releasable by waiting: you waive it, with the "Waive sync cooldown" workflow, or it stays out. [The 48-hour cooldown](codeharden-sync-cooldown.md) has the steps.

   **The last release** is read from the release tags of `origin`, not from the files: the newest tag whose commit is on `harden`'s own line, and the upstream base that release wrote. The script refuses when `VERSION` or `state/upstream-base` were changed since, or when a release that was made here has not been pushed. `publish.sh` has no cooldown check of its own: what it publishes is a tag, and the check holds for the tags this script made.

2. **Check the release out**, clean:

   ```sh
   git fetch origin --tags
   git checkout v2026.0105.0518
   ```

3. **Rehearse:**

   ```sh
   scripts/harden/publish.sh --dry-run
   ```

   It refuses unless the tree is clean and HEAD is the tag `v<VERSION>`. Then it installs dependencies, builds, packs `dist/npm/codeharden-<npm version>.tgz` and checks the tarball: the name, version, command and repository in its `package.json`, the files it must and must not contain, that the bundle was built from this `VERSION` for this package, and that its CLI starts and reports both versions. It prints the name, version, `bin` and file count, then what npm would publish. Nothing is published.

4. **Sign in to npm**, if `npm whoami` doesn't show your account:

   ```sh
   node scripts/harden/npm-release.mjs login   # npm login --auth-type=web, on the public registry
   ```

   npm prints a URL (`https://www.npmjs.com/login?next=/login/cli/...`); open it in your browser and approve. Nothing secret is typed into the terminal. It ends by naming the account: check that it is the one that may publish the package. npm then stays signed in on this computer until you run `npm logout`.

   An agent session may run this step for you, only as part of a publish you asked it for and only when npm is signed out: it passes you the URL and opens it, and you approve in your own browser. It never handles a password, a token or a one-time code; if npm asks for one in the terminal instead of printing a URL, it stops and you run `npm login` yourself.

5. **Publish:**

   ```sh
   scripts/harden/publish.sh
   ```

   It repeats the build, pack and checks, asks you to type the version, then runs `npm publish --access public`. npm prints another URL (`https://www.npmjs.com/auth/cli/...`) and waits while you approve with your second factor in the browser. No one-time code goes on the command line.

6. **Check it**, in an empty folder:

   ```sh
   npm view codeharden version
   npx codeharden@2026.105.518 --version
   ```

   Then go back to your branch: `git checkout harden`.

## Good to know

- **If npm says it published but the version isn't there:** `npm view codeharden versions` showing only `0.0.0-stage` means npm staged the release instead of publishing it. Approve it on npmjs.com under account settings > **Staged Packages** (it asks for your second factor); the version appears once approved.

- **If the publish fails with `E404`** ("404 Not Found - PUT https://registry.npmjs.org/codeharden", sometimes "is not in this registry" or "you do not have permission to access it"): that almost always means npm is not signed in or the sign-in expired. The registry answers 404, not 401, to a publish it can't authorise. It also happens when the signed-in account has no publish rights on the package. It doesn't mean the package or the version is broken, nothing was published, and the same version can be published again. (With no sign-in stored at all, npm says `ENEEDAUTH` instead: the same fix.) Run `npm whoami`: if it shows nobody, sign in (step 4) and publish again; if it shows an account and the publish still says 404, that account can't publish this package. The script checks this itself when a publish fails and says which it is.

- **A version can't be published twice**, and npm restricts unpublishing after 72 hours. If a release is wrong, publish a newer one and mark the bad one: `npm deprecate codeharden@<version> "<reason>"`.
- **The registry is always named** (`https://registry.npmjs.org`), so an npm config pointing elsewhere can't redirect a publish. `--registry` exists for tests.
- **Desktop installers** are a separate, manual step on GitHub: [Publishing CodeHarden's desktop installers](codeharden-desktop-release.md).
- **Nothing is published to npm from CI.** The Release workflow stays disabled, no npm token is stored anywhere, and there is no Trusted Publishing or provenance: every publish is you, signed in, at your machine.
- **A fork's own package:** in a fork of CodeHarden the package is the fork's `PACKAGE_NAME` repository variable, the links point at the fork's own repository (the `origin` remote) and its working branch; `publish.sh` reads them with `gh`, or from the environment (`PACKAGE_NAME`, `RELEASE_REPOSITORY`, `HARDEN_BRANCH`). Outside `harperaa/codeharden` there is no default package name: packing refuses until `PACKAGE_NAME` is set. Setting a fork up: [Make your own hardened fork](../README.md#make-your-own-hardened-fork).
