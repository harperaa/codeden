#!/usr/bin/env bash
# Cut a CodeHarden release in the current checkout: one commit
# `release: <version> (upstream <sha>)`, tagged `v<version>`, that writes
#
#   VERSION                  `YYYY.MMDD.HHMM`, the release time in America/New_York
#   CODEHARDEN-CHANGELOG.md  a new entry on top: the upstream commit subjects merged since the
#                            last release, and this fork's own since then (no merge commits)
#   state/upstream-base      the upstream commit this branch now contains, where the next
#                            release's upstream section starts
#
# The sync workflow (.github/workflows/upstream-sync-merge.yml) runs it after merging a sync,
# and a maintainer runs it after merging our own changes. Publishing to npm is separate
# (scripts/harden/publish.sh).
#
#   scripts/harden/release.sh             commit and tag locally, push nothing
#   scripts/harden/release.sh --dry-run   print what it would write, change nothing
#   scripts/harden/release.sh --push      also push the commit and the tag, in one atomic push
#
# It refuses to run when the tag already exists (here or on the remote), when tracked files
# have changes, or when the upstream base would move backwards. It never forces a push and
# never moves a tag. Plain bash, also on macOS's bash 3.2.
#
# Where the last release was is not read from the working tree: it is the newest release tag
# the remote has (this checkout's own tags when there is no remote) whose commit is on this
# branch's own line, and the upstream base is the one that release's commit wrote. The script
# refuses when VERSION or state/upstream-base have been changed since.
#
# The cooldown. Upstream changes ship only after they were approved and then waited 48 hours
# (scripts/harden/sync-cooldown.sh has the rule). Before every release the script asks GitHub
# (with `gh`) about what was merged since the last one: the pull request behind each step on
# which upstream commits arrived, at the moment it was merged, and every pull request that was
# squashed or rebased. It refuses when one had not waited, when upstream commits arrived
# without a pull request, or when GitHub can't be asked. The only way around is the owner's
# waiver (the "Waive sync cooldown" workflow); the release then says so, in its output and in
# the changelog entry. `--dry-run` gives the same verdict and the same exit status.
set -euo pipefail

REMOTE="${RELEASE_REMOTE:-origin}"
script_dir=$(cd "$(dirname "$0")" && pwd)
CHANGELOG_FILE="${CHANGELOG_FILE:-CODEHARDEN-CHANGELOG.md}"
CHANGELOG_TITLE="${CHANGELOG_TITLE:-# CodeHarden releases}"
BASE_FILE="${BASE_FILE:-state/upstream-base}"
RELEASE_TZ="${RELEASE_TZ:-America/New_York}"

dry_run=0
push=0
upstream_ref=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --push) push=1 ;;
    # A ref that already holds upstream's branch, instead of fetching it. It is checked
    # against the upstream itself, so it saves the fetch and nothing else.
    --upstream-ref) upstream_ref="${2:-}"; shift ;;
    -h | --help) sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "release: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

die() {
  echo "release: $*" >&2
  exit 1
}

cd "$(git rev-parse --show-toplevel 2> /dev/null)" || die "run this inside the repository"

# Which upstream this fork follows and which branch is released: the repository variables
# UPSTREAM_REPO, UPSTREAM_BRANCH and HARDEN_BRANCH (scripts/harden/fork-config.sh has the
# order they are looked up in, and CodeHarden's defaults).
FORK_CONFIG_WHO="release"
FORK_CONFIG_REMOTE="$REMOTE"
# shellcheck source=scripts/harden/fork-config.sh
. "${script_dir}/fork-config.sh"
fork_config_resolve UPSTREAM_REPO UPSTREAM_BRANCH HARDEN_BRANCH
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/${UPSTREAM_REPO}}"
UPSTREAM_NAME="${UPSTREAM_NAME:-$UPSTREAM_REPO}"
TARGET_BRANCH="${TARGET_BRANCH:-$HARDEN_BRANCH}"
# The changelog heading for this fork's own commits: the repository's name.
OWN_NAME="${OWN_NAME:-$(fork_lower "${FORK_REPO#*/}")}"
OWN_NAME="${OWN_NAME:-codeharden}"

for f in VERSION "$CHANGELOG_FILE" "$BASE_FILE"; do
  [ -f "$f" ] || die "this checkout has no $f; can't make a release"
done
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  die "tracked files have changes; commit or discard them first"
fi
if [ "$(head -n 1 "$CHANGELOG_FILE")" != "$CHANGELOG_TITLE" ]; then
  die "$CHANGELOG_FILE doesn't start with '$CHANGELOG_TITLE'"
fi

# Upstream's branch, as it is now. What "upstream" is, is not the caller's to say: a ref the
# caller names must be exactly where the configured upstream's branch is.
if [ -z "$upstream_ref" ]; then
  upstream_ref="refs/sync/upstream"
  git fetch --quiet --no-tags "$UPSTREAM_URL" "+refs/heads/${UPSTREAM_BRANCH}:${upstream_ref}" \
    || die "couldn't fetch ${UPSTREAM_BRANCH} from $UPSTREAM_URL"
else
  upstream_tip=$(git ls-remote "$UPSTREAM_URL" "refs/heads/${UPSTREAM_BRANCH}" 2> /dev/null | cut -f 1) || upstream_tip=""
  [ -n "$upstream_tip" ] || die "couldn't read ${UPSTREAM_BRANCH} from $UPSTREAM_URL, so $upstream_ref can't be checked against it"
  if [ "$(git rev-parse --verify --quiet "${upstream_ref}^{commit}" || true)" != "$upstream_tip" ]; then
    die "$upstream_ref is not where ${UPSTREAM_BRANCH} of $UPSTREAM_URL is now ($upstream_tip)"
  fi
fi
git cat-file -e "${upstream_ref}^{commit}" 2> /dev/null || die "$upstream_ref is not a commit here"

# The last release: the newest release tag whose commit is on this branch's own line. The
# tags are the remote's when there is one, so neither a tag made here and not pushed nor a
# file edited in a commit can move where the last release was.
fetch_remote=""
if git remote get-url "$REMOTE" > /dev/null 2>&1; then
  fetch_remote="$REMOTE"
  tags_of="$REMOTE"
  release_tags=$(git ls-remote --tags "$REMOTE" 'refs/tags/v*') || die "couldn't read the release tags of ${REMOTE}"
  # An annotated tag is listed twice; the line that ends in ^{} names its commit.
  release_tags=$(printf '%s\n' "$release_tags" | awk '{
    name = $2; peeled = 0
    if (substr(name, length(name) - 2) == "^{}") { name = substr(name, 1, length(name) - 3); peeled = 1 }
    if (peeled || !(name in commit)) commit[name] = $1
  } END { for (name in commit) print commit[name], name }')
else
  tags_of="this checkout"
  release_tags=$(git for-each-ref --format='%(objectname) %(*objectname) %(refname)' 'refs/tags/v*' \
    | awk '{ if (NF == 3) print $2, $3; else print $1, $2 }')
fi
own_line=$(mktemp)
git rev-list --first-parent HEAD > "$own_line"
last_tag=""
prev_release=""
while read -r tagged name; do
  name="${name#refs/tags/}"
  [[ "$name" =~ ^v[0-9]{4}\.[0-9]{4}\.[0-9]{4}$ ]] || continue
  grep -qx "$tagged" "$own_line" || continue
  last_tag="$name"
  prev_release="$tagged"
  break
done < <(printf '%s\n' "$release_tags" | sort -k 2,2r)
rm -f "$own_line"
[ -n "$last_tag" ] || die "no release tag of ${tags_of} is on this branch, so there is no last release to start from"
if [ "$(tr -d '[:space:]' < VERSION)" != "${last_tag#v}" ]; then
  die "VERSION says $(tr -d '[:space:]' < VERSION), but the last release ${tags_of} has on this branch is ${last_tag}. A release that was made here is pushed first; VERSION is written by a release only."
fi
prev_base=$(git show "${prev_release}:${BASE_FILE}" 2> /dev/null | tr -d '[:space:]') || prev_base=""
if ! [[ "$prev_base" =~ ^[0-9a-f]{40}$ ]] || ! git cat-file -e "${prev_base}^{commit}" 2> /dev/null; then
  die "$BASE_FILE of the last release (${last_tag}) doesn't hold a commit of this repository"
fi
if [ "$(tr -d '[:space:]' < "$BASE_FILE")" != "$prev_base" ]; then
  die "$BASE_FILE was changed since the last release (${last_tag} wrote ${prev_base}). It is written by a release only; put it back: git checkout ${last_tag} -- ${BASE_FILE}"
fi
# The newest upstream commit this branch contains.
new_base=$(git merge-base HEAD "$upstream_ref") || die "this branch shares no history with upstream"
if ! git merge-base --is-ancestor "$prev_base" "$new_base"; then
  die "the last release's upstream base ($prev_base) is not an ancestor of the upstream commit this branch now contains ($new_base)"
fi

# One clock reading for the version and the changelog heading. RELEASE_NOW replaces the clock
# in tests: "YYYY.MMDD.HHMM YYYY-MM-DD HH:MM".
now="${RELEASE_NOW:-$(TZ="$RELEASE_TZ" date '+%Y.%m%d.%H%M %Y-%m-%d %H:%M')}"
read -r version day time <<< "$now"
[[ "$version" =~ ^[0-9]{4}\.[0-9]{4}\.[0-9]{4}$ ]] || die "\"$version\" is not a version (YYYY.MMDD.HHMM)"
tag="v${version}"

if git rev-parse --verify --quiet "refs/tags/${tag}" > /dev/null; then
  die "tag ${tag} already exists. Nothing was changed; run it again in a minute."
fi
if git remote get-url "$REMOTE" > /dev/null 2>&1; then
  if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/${tag}" > /dev/null 2>&1; then
    die "tag ${tag} already exists on ${REMOTE}. Nothing was changed; run it again in a minute."
  fi
elif [ "$push" = 1 ]; then
  die "there is no remote named ${REMOTE} to push to"
fi

# The cooldown of what was merged since the last release.
cooldown_code=0
cooldown_notes=""
notes_file=$(mktemp)
cooldown_text=$(SYNC_COOLDOWN_REPO="${FORK_REPO:-${GITHUB_REPOSITORY:-}}" bash "${script_dir}/sync-cooldown-release.sh" \
  --since "$prev_release" --prev-base "$prev_base" --new-base "$new_base" --upstream-ref "$upstream_ref" \
  --branch "$TARGET_BRANCH" --remote "$fetch_remote" --notes "$notes_file") || cooldown_code=$?
if [ "$cooldown_code" = 0 ]; then cooldown_notes=$(cat "$notes_file"); fi
rm -f "$notes_file"
# Why the release is refused, when it is. Anything but a clear yes refuses.
cooldown_refusal() {
  if [ "$cooldown_code" = 1 ]; then
    printf 'release: refused. %s\n' "$cooldown_text"
  else
    printf 'release: refused. It could not be decided whether what was merged since the last release waited out its cooldown, and no release is cut without that answer.\n'
    [ -z "$cooldown_text" ] || printf '%s\n' "$cooldown_text"
    printf 'It needs the GitHub CLI on PATH, signed in (gh auth status), and a network.\n'
  fi
}
if [ "$cooldown_code" != 0 ] && [ "$dry_run" = 0 ]; then
  cooldown_refusal >&2
  die "nothing was changed"
fi

upstream_lines=$(git log --no-merges --pretty='- %s' "${prev_base}..${new_base}")
own_lines=$(git log --no-merges --pretty='- %s' "${prev_release}..HEAD" --not "$new_base")
short=$(git rev-parse --short=8 "$new_base")

entry() {
  printf '## %s — %s %s\n\n' "$version" "$day" "$time"
  # A waived cooldown stays on record with the release that shipped it.
  if [ -n "$cooldown_notes" ]; then printf '%s\n\n' "$cooldown_notes"; fi
  if [ -z "$upstream_lines" ] && [ -z "$own_lines" ]; then
    printf -- '- rebuild only (upstream base or dependency refresh)\n\n'
  fi
  if [ -n "$upstream_lines" ]; then printf '### upstream (%s)\n%s\n\n' "$UPSTREAM_NAME" "$upstream_lines"; fi
  if [ -n "$own_lines" ]; then printf '### %s\n%s\n\n' "$OWN_NAME" "$own_lines"; fi
}

if [ "$dry_run" = 1 ]; then
  echo "Dry run: nothing is written, committed, tagged or pushed."
  echo
  echo "VERSION:              $version (was $(tr -d '[:space:]' < VERSION))"
  echo "Tag:                  $tag"
  echo "Commit:               release: ${version} (upstream ${short})"
  echo "$BASE_FILE:  $new_base (was $prev_base)"
  echo
  echo "New entry in ${CHANGELOG_FILE}:"
  echo
  entry
  if [ "$cooldown_code" != 0 ]; then
    echo "A real run would stop here:"
    cooldown_refusal
    exit 1
  fi
  [ -z "$cooldown_text" ] || printf '%s\n' "$cooldown_text"
  exit 0
fi

new_changelog=$(mktemp)
trap 'rm -f "$new_changelog"' EXIT
{
  printf '%s\n\n' "$CHANGELOG_TITLE"
  entry
  tail -n +3 "$CHANGELOG_FILE"
} > "$new_changelog"
cp "$new_changelog" "$CHANGELOG_FILE"
printf '%s\n' "$version" > VERSION
printf '%s\n' "$new_base" > "$BASE_FILE"

git add VERSION "$CHANGELOG_FILE" "$BASE_FILE"
git commit --quiet -m "release: ${version} (upstream ${short})"
git tag -a "$tag" -m "CodeHarden ${version} (upstream ${short})"
echo "Released CodeHarden ${version} (${tag}), upstream base ${short}."
[ -z "$cooldown_text" ] || printf '%s\n' "$cooldown_text"

if [ "$push" = 1 ]; then
  # One atomic push, never forced: both the commit and the tag land, or neither.
  git push --atomic "$REMOTE" "HEAD:refs/heads/${TARGET_BRANCH}" "refs/tags/${tag}"
  echo "Pushed ${TARGET_BRANCH} and ${tag} to ${REMOTE}."
else
  echo "Not pushed. To publish the release: git push --atomic ${REMOTE} HEAD:refs/heads/${TARGET_BRANCH} refs/tags/${tag}"
fi
