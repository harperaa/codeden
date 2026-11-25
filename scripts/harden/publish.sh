#!/usr/bin/env bash
# Publish the checked-out CodeHarden release to npm. A person runs this on their own machine;
# nothing publishes from CI, and no token is stored anywhere.
#
#   scripts/harden/publish.sh             build, pack, check, then publish (asks first)
#   scripts/harden/publish.sh --dry-run   build, pack, check and show what npm would publish
#
# It refuses unless the tree is clean and HEAD is the release tag `v<VERSION>`, so the package
# always matches a tagged release. The package is renamed only in a staging copy at pack time
# (scripts/harden/npm-release.mjs, which does the work); the repository is not modified.
#
# The real publish runs `npm publish --access public` with no one-time code on the command
# line: npm prints a URL and waits while you approve in the browser. Sign in first if
# `npm whoami` doesn't show your account: `node scripts/harden/npm-release.mjs login` (in the
# browser too). A publish that fails with E404 almost always means npm is not signed in.
set -euo pipefail

dry_run=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    -h | --help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "publish: unknown option $arg" >&2; exit 2 ;;
  esac
done

die() {
  echo "publish: $*" >&2
  exit 1
}

script_dir=$(cd "$(dirname "$0")" && pwd)
cd "$(git rev-parse --show-toplevel 2> /dev/null)" || die "run this inside the repository"
[ -f VERSION ] || die "this checkout has no VERSION"
version=$(tr -d '[:space:]' < VERSION)
tag="v${version}"

if [ -n "$(git status --porcelain)" ]; then
  die "the working tree has changes; commit or discard them first"
fi
# Only the release tag itself is published. The cooldown of upstream changes has no check of
# its own here: it holds for a tag that release.sh made, because that script refuses a
# release whose upstream commits had not waited (scripts/harden/sync-cooldown.sh). This
# script can't tell a tag that was made by hand.
tagged=$(git rev-parse --verify --quiet "refs/tags/${tag}^{commit}" || true)
[ -n "$tagged" ] || die "the tag ${tag} is not in this checkout. Fetch it: git fetch origin tag ${tag}"
if [ "$tagged" != "$(git rev-parse HEAD)" ]; then
  die "HEAD is not the release ${tag}. Check it out first: git checkout ${tag}"
fi

# The package this fork publishes, its repository and its working branch, for the build and
# the pack (scripts/harden/fork-config.sh). Outside CodeHarden's own repository PACKAGE_NAME
# has no default: a fork must never publish, or update its users, as `codeharden`.
FORK_CONFIG_WHO="publish"
FORK_CONFIG_STRICT=1
# shellcheck source=scripts/harden/fork-config.sh
. "${script_dir}/fork-config.sh"
fork_config_resolve PACKAGE_NAME HARDEN_BRANCH
RELEASE_REPOSITORY="${RELEASE_REPOSITORY:-$FORK_REPO}"
[ -n "$RELEASE_REPOSITORY" ] || die "RELEASE_REPOSITORY is not set and the origin remote is not a GitHub repository; export RELEASE_REPOSITORY=<owner/repo>"
export PACKAGE_NAME HARDEN_BRANCH RELEASE_REPOSITORY

script="scripts/harden/npm-release.mjs"
node "$script" pack
if [ "$dry_run" = 1 ]; then
  node "$script" publish --dry-run
  exit 0
fi

npm_version=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("dist/npm/release.json", "utf8")).version)')
name=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("dist/npm/release.json", "utf8")).name)')
echo
echo "About to publish ${name}@${npm_version} (CodeHarden ${version}) to npm."
echo "A published version can never be replaced."
printf 'Type the version to publish, or anything else to stop: '
read -r answer
[ "$answer" = "$npm_version" ] || die "stopped; nothing was published"
node "$script" publish --confirm "$npm_version"
