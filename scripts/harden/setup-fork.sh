#!/usr/bin/env bash
# Set a hardened fork up on GitHub: the daily sync from its upstream, releases and the npm
# package under its own names. Run it once in a clone of your fork, with your own `gh` and
# `git` sign-in; run it again any time, it only changes what is not yet right.
#
#   scripts/harden/setup-fork.sh --package <npm name>            a fork of CodeHarden
#   scripts/harden/setup-fork.sh --package <npm name> --dry-run  say what it would change
#
#   --repo <owner/repo>       the fork to set up (default: the `origin` remote)
#   --upstream <owner/repo>   the repository it follows (default: harperaa/codeharden)
#   --upstream-branch <name>  the branch of it that is followed (default: harden)
#   --package <name>          the npm package the fork publishes (no default in a fork)
#   --branch <name>           the fork's working, default branch (default: harden)
#   --mirror-branch <name>    the pure mirror of the upstream branch (default: the upstream
#                             branch's name, or `mirror` when the working branch has it)
#   --dry-run                 change nothing, here or on GitHub
#
# What it does, each step reported as "already set" or "changed":
#   - the repository variables UPSTREAM_REPO, UPSTREAM_BRANCH and PACKAGE_NAME (and
#     HARDEN_BRANCH / MIRROR_BRANCH when they are not the defaults);
#   - the mirror branch: created at the upstream branch's commit if missing, fast-forwarded
#     if behind, left alone (and reported) if it has commits of its own;
#   - the working branch, created at the same commit if missing, and made the default branch;
#   - the labels sync-approved, sync-needs-review and sync-hold;
#   - Actions enabled, the "Upstream sync merge" workflow enabled, the Release workflow
#     disabled.
# It creates no environment and touches no secret: the `release` environment that the Desktop
# installers workflow signs and publishes behind is made by the owner, by hand (it is named
# under "Left for you").
# It never forces a push, never deletes or rewrites anything and stores no token: upstream is
# fetched over HTTPS without credentials, and everything else uses your own sign-in. A step
# your sign-in may not do is reported with what it needs, and the rest still runs. It ends
# with a summary and what is left for you.
#
# In CodeHarden's own repository the defaults are CodeHarden's (leonvanzyl/codeden, main,
# codeharden). Plain bash, also on macOS's bash 3.2.
set -uo pipefail

FORK_CONFIG_WHO="setup-fork"
script_dir=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=scripts/harden/fork-config.sh
. "${script_dir}/fork-config.sh"

die() { fork_config_die "$@"; }

repo="" upstream="" upstream_branch="" package="" branch="" mirror="" dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) repo="${2:-}"; shift ;;
    --upstream) upstream="${2:-}"; shift ;;
    --upstream-branch) upstream_branch="${2:-}"; shift ;;
    --package) package="${2:-}"; shift ;;
    --branch) branch="${2:-}"; shift ;;
    --mirror-branch) mirror="${2:-}"; shift ;;
    --dry-run) dry_run=1 ;;
    -h | --help) sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "setup-fork: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

command -v git > /dev/null 2>&1 || die "git is not installed"
command -v gh > /dev/null 2>&1 || die "the GitHub CLI (gh) is not installed: https://cli.github.com"

SYNC_WORKFLOW="upstream-sync-merge.yml"
RELEASE_WORKFLOW="release.yml"

# --- What to set up ------------------------------------------------------------------------

origin_repo=$(fork_origin_repo origin)
[ -n "$repo" ] || repo="$origin_repo"
[ -n "$repo" ] || die "the origin remote is not a GitHub repository; pass --repo <owner/repo>"
fork_valid_repo "$repo" || die "--repo must be a GitHub owner/repo, found \"$repo\""

if ! info=$(gh api "repos/${repo}" --jq '[.full_name, .default_branch, (.has_issues | tostring), (.allow_merge_commit | tostring), (.permissions.admin | tostring)] | join(" ")' 2> /dev/null); then
  die "can't read ${repo} with gh. Sign in first (gh auth login) and check the name."
fi
read -r full_name default_branch has_issues allow_merge is_admin <<< "$info"
repo="$full_name"

# A value: the option, else the repository variable already there, else the default.
variable() {
  gh variable get "$1" --repo "$repo" 2> /dev/null || true
}
cur_upstream=$(variable UPSTREAM_REPO)
cur_upstream_branch=$(variable UPSTREAM_BRANCH)
cur_package=$(variable PACKAGE_NAME)
cur_branch=$(variable HARDEN_BRANCH)
cur_mirror=$(variable MIRROR_BRANCH)

if fork_is_codeharden "$repo"; then
  default_upstream="$CODEHARDEN_UPSTREAM_REPO"
  default_upstream_branch="$CODEHARDEN_UPSTREAM_BRANCH"
  default_package="$CODEHARDEN_PACKAGE_NAME"
else
  default_upstream="$CODEHARDEN_REPO"
  default_upstream_branch="$DEFAULT_HARDEN_BRANCH"
  default_package=""
fi
upstream="${upstream:-${cur_upstream:-$default_upstream}}"
upstream_branch="${upstream_branch:-${cur_upstream_branch:-$default_upstream_branch}}"
package="${package:-${cur_package:-$default_package}}"
[ -n "$package" ] || die "pass --package <name>: the npm package your fork publishes. A fork has no default, so that it never publishes or updates its users as ${CODEHARDEN_PACKAGE_NAME}."
# The two branch names are stored as variables only when they are not the derived defaults.
branch_given="${branch:-$cur_branch}"
branch="${branch_given:-$DEFAULT_HARDEN_BRANCH}"
derived_mirror=$(fork_default_mirror "$upstream_branch" "$branch")
mirror_given="${mirror:-$cur_mirror}"
mirror="${mirror_given:-$derived_mirror}"

fork_valid_repo "$upstream" || die "--upstream must be a GitHub owner/repo, found \"$upstream\""
fork_valid_branch "$upstream_branch" || die "--upstream-branch must be a branch name, found \"$upstream_branch\""
fork_valid_package "$package" || die "--package must be an npm package name, found \"$package\""
fork_valid_branch "$branch" || die "--branch must be a branch name, found \"$branch\""
fork_valid_branch "$mirror" || die "--mirror-branch must be a branch name, found \"$mirror\""
[ "$mirror" != "$branch" ] || die "the mirror branch and the working branch are both ${branch}; they must differ"
[ "$(fork_lower "$upstream")" != "$(fork_lower "$repo")" ] || die "--upstream is ${repo} itself"
if ! fork_is_codeharden "$repo" && [ "$package" = "$CODEHARDEN_PACKAGE_NAME" ]; then
  die "--package ${CODEHARDEN_PACKAGE_NAME} is CodeHarden's own npm package; choose your fork's own name"
fi

# Where git reads and writes. The two *_URL variables exist for the tests.
upstream_url="${SETUP_FORK_UPSTREAM_URL:-https://github.com/${upstream}}"
if [ -n "${SETUP_FORK_REPO_URL:-}" ]; then
  repo_remote="$SETUP_FORK_REPO_URL"
elif [ "$(fork_lower "$origin_repo")" = "$(fork_lower "$repo")" ]; then
  repo_remote="origin"
else
  repo_remote="https://github.com/${repo}"
fi

# --- Reporting -----------------------------------------------------------------------------

changed=0 already=0 manual_count=0 manual_list=""
ok() { already=$((already + 1)); printf '  already set   %s\n' "$1"; }
did() {
  changed=$((changed + 1))
  if [ "$dry_run" = 1 ]; then printf '  would change  %s\n' "$1"; else printf '  changed       %s\n' "$1"; fi
}
# Something a person has to do: a missing permission, or a state this script won't touch.
manual() {
  manual_count=$((manual_count + 1))
  manual_list="${manual_list}  - $1
"
  printf '  not done      %s\n' "$1"
}
# Run a command that changes something on GitHub; in a dry run, don't.
apply() {
  [ "$dry_run" = 1 ] && return 0
  "$@" > /dev/null 2> "$err_file"
}
why() { tr '\n' ' ' < "$err_file" | cut -c 1-300; }
# No stored credential is offered to upstream: a public repository, read anonymously.
anonymous_git() {
  GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c http.extraheader= -c core.askPass= "$@"
}
remote_sha() { # url-or-remote, branch
  git ls-remote "$1" "refs/heads/$2" 2> /dev/null | cut -f 1 | head -n 1
}

err_file=$(mktemp)
trap 'rm -f "$err_file"' EXIT

echo "Setting up ${repo} as a hardened fork of ${upstream} (${upstream_branch})."
echo "  mirror branch: ${mirror}   working branch: ${branch}   npm package: ${package}"
[ "$dry_run" = 0 ] || echo "Dry run: nothing is changed, here or on GitHub."
[ "$is_admin" = "true" ] || echo "Note: your sign-in is not an admin of ${repo}; some steps may be refused."
echo

# --- Variables -----------------------------------------------------------------------------

echo "Repository variables"
set_variable() { # name, current, wanted
  if [ "$2" = "$3" ]; then ok "$1 = $3"; return; fi
  if apply gh variable set "$1" --repo "$repo" --body "$3"; then
    if [ -n "$2" ]; then did "$1 = $3 (was $2)"; else did "$1 = $3 (new)"; fi
  else
    manual "set the repository variable $1 to $3 (gh: $(why))"
  fi
}
set_variable UPSTREAM_REPO "$cur_upstream" "$upstream"
set_variable UPSTREAM_BRANCH "$cur_upstream_branch" "$upstream_branch"
set_variable PACKAGE_NAME "$cur_package" "$package"
# Only when they are not what the workflow and the scripts derive anyway.
if [ -n "$cur_branch" ] || [ "$branch" != "$DEFAULT_HARDEN_BRANCH" ]; then
  set_variable HARDEN_BRANCH "$cur_branch" "$branch"
fi
if [ -n "$cur_mirror" ] || [ "$mirror" != "$derived_mirror" ]; then
  set_variable MIRROR_BRANCH "$cur_mirror" "$mirror"
fi
echo

# --- Branches ------------------------------------------------------------------------------

echo "Branches"
upstream_sha=$(anonymous_git ls-remote "$upstream_url" "refs/heads/${upstream_branch}" 2> /dev/null | cut -f 1 | head -n 1)
have_upstream=0
if [ -z "$upstream_sha" ]; then
  manual "couldn't read ${upstream_branch} of ${upstream_url} (is the repository public, and the branch name right?); the branches were not checked"
else
  # The commits are needed here to compare and to push them; a dry run fetches nothing.
  if git cat-file -e "${upstream_sha}^{commit}" 2> /dev/null; then
    have_upstream=1
  elif [ "$dry_run" = 0 ]; then
    if anonymous_git fetch --quiet --no-tags "$upstream_url" "refs/heads/${upstream_branch}" 2> "$err_file" \
      && git cat-file -e "${upstream_sha}^{commit}" 2> /dev/null; then
      have_upstream=1
    else
      manual "couldn't fetch ${upstream_branch} from ${upstream_url} ($(why))"
    fi
  fi

  # A plain push of one commit to one branch: git refuses anything that is not a fast-forward.
  push_branch() { # branch, what to say
    if [ "$dry_run" = 1 ]; then did "$2"; return; fi
    if [ "$have_upstream" = 0 ]; then return; fi
    if git push --quiet "$repo_remote" "${upstream_sha}:refs/heads/$1" 2> "$err_file"; then
      did "$2"
    elif grep -qi "workflow" "$err_file"; then
      manual "push ${upstream_sha} to the branch $1: refused because the commits change workflow files, which your git sign-in may not push. Allow it (gh auth refresh --scopes workflow) and run this again."
    else
      manual "push ${upstream_sha} to the branch $1 ($(why))"
    fi
  }

  mirror_sha=$(remote_sha "$repo_remote" "$mirror")
  short=$(printf '%s' "$upstream_sha" | cut -c 1-8)
  if [ -z "$mirror_sha" ]; then
    push_branch "$mirror" "mirror branch ${mirror} created at upstream ${upstream_branch} (${short})"
  elif [ "$mirror_sha" = "$upstream_sha" ]; then
    ok "mirror branch ${mirror} is at upstream ${upstream_branch} (${short})"
  else
    if ! git cat-file -e "${mirror_sha}^{commit}" 2> /dev/null && [ "$dry_run" = 0 ]; then
      git fetch --quiet --no-tags "$repo_remote" "refs/heads/${mirror}" 2> /dev/null || true
    fi
    if [ "$have_upstream" = 1 ] && git cat-file -e "${mirror_sha}^{commit}" 2> /dev/null; then
      if git merge-base --is-ancestor "$mirror_sha" "$upstream_sha"; then
        push_branch "$mirror" "mirror branch ${mirror} fast-forwarded to upstream ${upstream_branch} (${short})"
      elif git merge-base --is-ancestor "$upstream_sha" "$mirror_sha"; then
        manual "the branch ${mirror} is ahead of upstream ${upstream_branch}: it has commits upstream doesn't have, so it is not a pure mirror. Left alone. Use another --mirror-branch, or move those commits yourself."
      else
        manual "the branch ${mirror} and upstream ${upstream_branch} have diverged, so it can't be fast-forwarded. Left alone. Use another --mirror-branch, or sort the branch out yourself."
      fi
    elif [ "$dry_run" = 1 ]; then
      did "mirror branch ${mirror} fast-forwarded to upstream ${upstream_branch} (${short}), if it is behind (a dry run fetches nothing, so this was not compared)"
    else
      manual "couldn't compare the branch ${mirror} with upstream ${upstream_branch}; left alone"
    fi
  fi

  if [ -n "$(remote_sha "$repo_remote" "$branch")" ]; then
    ok "working branch ${branch} exists"
  else
    push_branch "$branch" "working branch ${branch} created at upstream ${upstream_branch} (${short})"
  fi
fi

if [ "$default_branch" = "$branch" ]; then
  ok "default branch is ${branch}"
elif [ "$dry_run" = 0 ] && [ -z "$(remote_sha "$repo_remote" "$branch")" ]; then
  manual "make ${branch} the default branch (it doesn't exist yet)"
elif apply gh api --method PATCH "repos/${repo}" --raw-field "default_branch=${branch}"; then
  did "default branch is ${branch} (was ${default_branch})"
else
  manual "make ${branch} the default branch, under Settings > General (gh: $(why))"
fi
echo

# --- Labels --------------------------------------------------------------------------------

echo "Labels"
if labels=$(gh api --paginate "repos/${repo}/labels?per_page=100" --jq '.[].name' 2> "$err_file"); then
  label() { # name, colour, description
    if printf '%s\n' "$labels" | grep -qx "$1"; then ok "label $1"; return; fi
    if apply gh api --method POST "repos/${repo}/labels" --raw-field "name=$1" --raw-field "color=$2" --raw-field "description=$3"; then
      did "label $1 created"
    else
      manual "create the label $1 (gh: $(why))"
    fi
  }
  label sync-approved 0e8a16 "Sync pull request reviewed: merges 48 hours after this label"
  label sync-needs-review d93f0b "Sync pull request that a person must review and merge"
  label sync-hold fbca04 "Sync pull request that must not merge yet"
else
  manual "create the labels sync-approved, sync-needs-review and sync-hold (gh couldn't list labels: $(why))"
fi
echo

# --- Actions and workflows -----------------------------------------------------------------

echo "Actions"
if actions=$(gh api "repos/${repo}/actions/permissions" --jq '.enabled | tostring' 2> "$err_file"); then
  if [ "$actions" = "true" ]; then
    ok "Actions are enabled"
  elif apply gh api --method PUT "repos/${repo}/actions/permissions" --field "enabled=true"; then
    did "Actions enabled"
  else
    manual "enable Actions, under Settings > Actions > General (gh: $(why))"
  fi
else
  manual "check that Actions are enabled, under Settings > Actions > General (gh couldn't read the setting; it needs admin rights: $(why))"
fi

workflow() { # file, enable|disable, name
  local state
  if ! state=$(gh api "repos/${repo}/actions/workflows/$1" --jq '.state' 2> "$err_file"); then
    if [ "$2" = "disable" ]; then
      ok "the $3 workflow is not active (GitHub doesn't list it)"
    else
      manual "enable the $3 workflow: GitHub doesn't list it yet. On a new fork, open the Actions tab and press \"I understand my workflows, go ahead and enable them\", then run this again."
    fi
    return
  fi
  if [ "$2" = "enable" ]; then
    if [ "$state" = "active" ]; then ok "the $3 workflow is enabled"; return; fi
  else
    if [ "$state" != "active" ]; then ok "the $3 workflow is disabled"; return; fi
  fi
  if apply gh api --method PUT "repos/${repo}/actions/workflows/$1/$2"; then
    did "the $3 workflow ${2}d (was ${state})"
  else
    manual "$2 the $3 workflow, in the Actions tab (gh: $(why))"
  fi
}
workflow "$SYNC_WORKFLOW" enable "Upstream sync merge"
workflow "$RELEASE_WORKFLOW" disable "Release"
echo

# --- Summary -------------------------------------------------------------------------------

if [ "$dry_run" = 1 ]; then
  echo "Dry run: ${changed} would change, ${already} already set, ${manual_count} not done."
else
  echo "Done: ${changed} changed, ${already} already set, ${manual_count} not done."
fi
if [ "$manual_count" -gt 0 ]; then
  echo
  echo "Not done, for you to look at:"
  printf '%s' "$manual_list"
fi
echo
echo "Left for you:"
[ "$has_issues" = "true" ] || echo "  - Issues are off in ${repo}. Turn them on under Settings > General if you want bug reports there."
[ "$allow_merge" = "true" ] || echo "  - Merge commits are not allowed in ${repo}. Allow them under Settings > General > Pull Requests: sync pull requests merge with a merge commit."
cat << EOF
  - Sync pull requests: branches named sync/..., opened against ${branch}, each reviewed and
    then labelled sync-approved (it merges 48 hours later), sync-needs-review or sync-hold.
    A CodeDen automation can do the daily review, or you review them yourself and set the
    labels. The README section "Make your own hardened fork" has both.
  - The 48 hours: the pull request shows them as the status "Sync cooldown", and
    scripts/harden/release.sh refuses to release a sync that was merged sooner. The only way
    around is the "Waive sync cooldown" workflow, which waits for an approval in a GitHub
    environment named sync-waiver that only you can make: Settings > Environments, with
    required reviewers, the administrators' bypass off, only the branch ${branch}, and no
    secrets. Without it nothing can be waived. docs/codeharden-sync-cooldown.md has the steps.
  - Optional, once per clone: git config core.hooksPath scripts/harden/hooks runs typecheck
    and lint before each push. The tests run in CI, on pull requests into ${branch}.
  - Releases: scripts/harden/release.sh --dry-run, then --push. npm: scripts/harden/publish.sh,
    signed in to npm as the owner of ${package}.
  - Desktop installers: the "Desktop installers" workflow, run by hand. A dry run works at
    once. A run that publishes waits for an approval and reads its signing secrets from a
    GitHub environment named release, which only you can make: Settings > Environments, with
    required reviewers, only the branch ${branch}, and the secrets as environment secrets.
    This script creates no environment and touches no secret. Without certificates or
    reviewers, set the variables SIGNED_INSTALLERS=none and RELEASE_APPROVAL=none instead.
    docs/codeharden-desktop-release.md has the steps.
  - The Release workflow (${RELEASE_WORKFLOW}) stays disabled; nothing publishes from CI.
EOF
if [ "$manual_count" -gt 0 ]; then exit 1; fi
