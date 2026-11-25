# A stand-in for `gh` in the desktop installers workflow's step tests: sourced before a step's
# script, it defines `gh` as a function that answers `gh api <path>` from the FIXTURE_*
# variables and applies the step's own `--jq` filter with the real `jq`. An empty fixture is
# GitHub's "Not Found". It knows only the calls the workflow's check job makes. `git` answers
# the one question the build jobs ask: which commit is checked out.
git() {
  if [ "$*" != "rev-parse HEAD" ]; then
    echo "stub git: unexpected call: $*" >&2
    return 2
  fi
  printf '%s\n' "${FIXTURE_CHECKED_OUT:?}"
}

gh() {
  local path="$2" filter="" body=""
  shift 2
  while [ $# -gt 0 ]; do
    case "$1" in
      --jq) filter="$2"; shift ;;
      -H) shift ;;
    esac
    shift
  done
  case "$path" in
    */environments/release) body="${FIXTURE_ENVIRONMENT:-}" ;;
    */environments/release/deployment-branch-policies\?per_page=100)
      body="${FIXTURE_BRANCH_POLICIES:-}" ;;
    */git/ref/tags/*) if [ -n "${FIXTURE_TAG_SHA:-}" ]; then body='{"ref":"a tag"}'; fi ;;
    */commits/refs/tags/*)
      if [ -n "${FIXTURE_TAG_SHA:-}" ]; then body="{\"sha\":\"${FIXTURE_TAG_SHA}\"}"; fi ;;
    */commits/refs/heads/"${DEFAULT_BRANCH}") body="{\"sha\":\"${FIXTURE_HEAD_SHA}\"}" ;;
    # Only in this order: the default branch first, then the tag's commit.
    */compare/"${FIXTURE_HEAD_SHA}...${FIXTURE_TAG_SHA}") body="{\"ahead_by\":${FIXTURE_AHEAD_BY}}" ;;
    */contents/VERSION\?ref="${FIXTURE_TAG_SHA}")
      printf '%s\n' "${FIXTURE_VERSION}"
      return 0
      ;;
    *)
      echo "stub gh: unexpected call: ${path}" >&2
      return 2
      ;;
  esac
  if [ -z "$body" ]; then
    echo "gh: Not Found (HTTP 404)" >&2
    return 1
  fi
  if [ -n "$filter" ]; then printf '%s' "$body" | jq -r "$filter"; else printf '%s' "$body"; fi
}
