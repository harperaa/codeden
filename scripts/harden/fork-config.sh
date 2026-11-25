# The fork's configuration for the shell scripts (release.sh, publish.sh, setup-fork.sh).
# Sourced, never run. Plain bash, also on macOS's bash 3.2.
#
# A hardened fork is described by three values, kept as repository variables on GitHub
# (scripts/harden/setup-fork.sh creates them):
#
#   UPSTREAM_REPO     the `owner/repo` this fork follows         CodeHarden: leonvanzyl/codeden
#   UPSTREAM_BRANCH   the branch of it that is followed          CodeHarden: main
#   PACKAGE_NAME      the npm package this fork publishes        CodeHarden: codeharden
#
# and two branch names that are derived unless a variable of that name says otherwise:
#
#   HARDEN_BRANCH     the working (default) branch: upstream plus this fork's own changes.
#                     Default `harden`.
#   MIRROR_BRANCH     the pure mirror of the upstream branch, fast-forward only. Default: the
#                     upstream branch's own name (`main`), or `mirror` when that name is taken
#                     by the working branch (a fork of CodeHarden follows `harden`).
#
# The release repository needs no variable: it is this repository (the `origin` remote here,
# `github.repository` in a workflow).
#
# `fork_config_resolve NAME...` gives each named value, in this order:
#   1. the environment variable of that name;
#   2. the repository variable, read with `gh variable get` (only when `origin` is a GitHub
#      repository other than CodeHarden; FORK_CONFIG_NO_GH=1 skips it);
#   3. CodeHarden's value, but only in CodeHarden itself or in a checkout whose `origin` is not
#      a GitHub repository (a scratch clone; not even there when publishing). In any other repository the three values above
#      have no default: the script stops and names the variable, so a fork never releases or
#      publishes as CodeHarden because a default leaked through.
# Every value is checked for its shape before it is used.

CODEHARDEN_REPO="harperaa/codeharden"
CODEHARDEN_UPSTREAM_REPO="leonvanzyl/codeden"
CODEHARDEN_UPSTREAM_BRANCH="main"
CODEHARDEN_PACKAGE_NAME="codeharden"
DEFAULT_HARDEN_BRANCH="harden"
FALLBACK_MIRROR_BRANCH="mirror"

fork_config_die() {
  echo "${FORK_CONFIG_WHO:-fork-config}: $*" >&2
  exit 1
}

# A GitHub `owner/repo`.
fork_valid_repo() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?/[A-Za-z0-9._-]+$ ]] || return 1
  case "${1#*/}" in . | ..) return 1 ;; esac
}

# A branch name: no spaces or ref syntax, nothing git would refuse.
fork_valid_branch() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || return 1
  case "$1" in *..* | *//* | */ | *. | *.lock | */.*) return 1 ;; esac
}

# An npm package name: `name` or `@scope/name`, lower case.
fork_valid_package() {
  [[ "$1" =~ ^(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$ ]]
}

fork_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# The `owner/repo` of a github.com URL; prints nothing for anything else.
fork_repo_of_url() {
  local url="$1" path=""
  case "$url" in
    https://github.com/*) path="${url#https://github.com/}" ;;
    http://github.com/*) path="${url#http://github.com/}" ;;
    git@github.com:*) path="${url#git@github.com:}" ;;
    ssh://git@github.com/*) path="${url#ssh://git@github.com/}" ;;
    git://github.com/*) path="${url#git://github.com/}" ;;
    *) return 0 ;;
  esac
  path="${path%/}"
  path="${path%.git}"
  if fork_valid_repo "$path"; then printf '%s\n' "$path"; fi
}

# The `owner/repo` of a remote (default `origin`) of the current checkout, if it is on GitHub.
fork_origin_repo() {
  local url
  url=$(git remote get-url "${1:-origin}" 2> /dev/null) || return 0
  fork_repo_of_url "$url"
}

fork_is_codeharden() {
  [ "$(fork_lower "$1")" = "$CODEHARDEN_REPO" ]
}

# The mirror branch for an upstream branch and a working branch, when nothing names one.
fork_default_mirror() {
  if [ "$1" = "$2" ]; then printf '%s\n' "$FALLBACK_MIRROR_BRANCH"; else printf '%s\n' "$1"; fi
}

fork_config_check() {
  local name="$1" value="$2"
  case "$name" in
    UPSTREAM_REPO)
      fork_valid_repo "$value" || fork_config_die "$name must be a GitHub owner/repo, found \"$value\"" ;;
    UPSTREAM_BRANCH | HARDEN_BRANCH | MIRROR_BRANCH)
      fork_valid_branch "$value" || fork_config_die "$name must be a branch name, found \"$value\"" ;;
    PACKAGE_NAME)
      fork_valid_package "$value" || fork_config_die "$name must be an npm package name, found \"$value\"" ;;
  esac
}

# The repository variable NAME of REPO, or nothing.
fork_repo_variable() {
  [ -z "${FORK_CONFIG_NO_GH:-}" ] || return 0
  command -v gh > /dev/null 2>&1 || return 0
  gh variable get "$1" --repo "$2" 2> /dev/null || true
}

# Sets FORK_REPO (the origin's `owner/repo`, empty when it is not on GitHub) and each named
# value as a shell variable. See the top of this file for the order.
fork_config_resolve() {
  local name value own=0
  FORK_REPO=$(fork_origin_repo "${FORK_CONFIG_REMOTE:-origin}")
  if [ -z "$FORK_REPO" ]; then
    # FORK_CONFIG_STRICT=1 (publishing): only CodeHarden's own origin gets CodeHarden's values.
    [ -n "${FORK_CONFIG_STRICT:-}" ] || own=1
  elif fork_is_codeharden "$FORK_REPO"; then
    own=1
  fi
  # MIRROR_BRANCH is derived from the two others, so it goes last whatever the order asked for.
  for name in $(printf '%s\n' "$@" | grep -v '^MIRROR_BRANCH$') $(printf '%s\n' "$@" | grep '^MIRROR_BRANCH$'); do
    value="${!name:-}"
    if [ -z "$value" ] && [ "$own" = 0 ] && [ -n "$FORK_REPO" ]; then
      value=$(fork_repo_variable "$name" "$FORK_REPO")
    fi
    if [ -z "$value" ]; then
      case "$name" in
        HARDEN_BRANCH) value="$DEFAULT_HARDEN_BRANCH" ;;
        MIRROR_BRANCH)
          fork_config_resolve UPSTREAM_BRANCH HARDEN_BRANCH
          value=$(fork_default_mirror "$UPSTREAM_BRANCH" "$HARDEN_BRANCH") ;;
        *)
          if [ "$own" = 0 ]; then
            fork_config_die "$name is not set, and this checkout's origin is ${FORK_REPO:-not a GitHub repository}, not ${CODEHARDEN_REPO}, so CodeHarden's value is not used. Create the repository variable (scripts/harden/setup-fork.sh does) or export ${name}."
          fi
          case "$name" in
            UPSTREAM_REPO) value="$CODEHARDEN_UPSTREAM_REPO" ;;
            UPSTREAM_BRANCH) value="$CODEHARDEN_UPSTREAM_BRANCH" ;;
            PACKAGE_NAME) value="$CODEHARDEN_PACKAGE_NAME" ;;
            *) fork_config_die "unknown configuration value $name" ;;
          esac ;;
      esac
    fi
    fork_config_check "$name" "$value"
    printf -v "$name" '%s' "$value"
  done
}
