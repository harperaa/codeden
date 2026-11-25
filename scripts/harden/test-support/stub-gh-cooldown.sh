#!/usr/bin/env bash
# A stand-in for `gh` in the cooldown tests: GitHub's answers are JSON files in $GH_STATE
# (test-support/cooldown.mjs writes them), every call is written to $GH_STATE/log, and a
# call's own `--jq` filter is applied with the real `jq`. It knows only the calls the
# cooldown scripts make. A line in $GH_STATE/fail is a pattern: a call whose
# "<method> <path>" matches it fails the way a GitHub outage does.
#
# Lists come in pages, as GitHub's do: `per_page` entries (30 unless the call says otherwise),
# the page the call names, and every page only with `--paginate`, where the filter is applied
# to each page by itself.
set -euo pipefail
state="${GH_STATE:?}"
# One line for each call, whatever its filter looks like.
printf '%s\n' "$(printf '%s' "$*" | tr '\n' ' ')" >> "$state/log"

[ "${1:-}" = "api" ] || { echo "stub gh: unexpected call: $*" >&2; exit 2; }
shift
method="GET" path="" filter="" fields="" paginate=0
while [ $# -gt 0 ]; do
  case "$1" in
    --method) method="$2"; shift ;;
    --jq) filter="$2"; shift ;;
    -f) fields="${fields}$2
"; shift ;;
    --paginate) paginate=1 ;;
    repos/*) path="$1" ;;
    *) echo "stub gh: unexpected argument $1" >&2; exit 2 ;;
  esac
  shift
done
field() { printf '%s' "$fields" | sed -n "s/^$1=//p" | head -n 1; }

if [ -f "$state/fail" ]; then
  while IFS= read -r pattern; do
    if [ -n "$pattern" ] && [[ "$method $path" =~ $pattern ]]; then
      echo "gh: Bad Gateway (HTTP 502)" >&2
      exit 1
    fi
  done < "$state/fail"
fi

rest="${path#repos/*/*/}"
# The answer is a file, or what GitHub says when there is nothing ($2), or a 404.
answer() {
  if [ -f "$state/$1" ]; then cat "$state/$1"; elif [ $# -gt 1 ]; then printf '%s' "$2"; else
    echo "gh: Not Found (HTTP 404)" >&2
    exit 1
  fi
}

case "$method $rest" in
  "GET pulls?state=open"*) body=$(answer open-pulls.json '[]') ;;
  "GET pulls") body=$(answer closed-pulls.json '[]') ;;
  "GET pulls/"*) body=$(answer "pulls/${rest#pulls/}.json") ;;
  "GET issues/"*/timeline*)
    number="${rest#issues/}"
    body=$(answer "timeline/${number%%/*}.json" '[]') ;;
  "GET activity")
    ref=$(field ref)
    branch="${ref#refs/heads/}"
    body=$(answer "activity/${branch//\//__}.json" '[]') ;;
  "GET git/ref/heads/"*)
    branch="${rest#git/ref/heads/}"
    body=$(answer "refs/${branch//\//__}.json") ;;
  "GET commits/"*/pulls)
    sha="${rest#commits/}"
    sha="${sha%/pulls}"
    if [ -f "$state/not-pushed" ] && grep -qx "$sha" "$state/not-pushed"; then
      echo "gh: No commit found for SHA: ${sha} (HTTP 422)" >&2
      exit 1
    fi
    body=$(answer "commit-pulls/${sha}.json" '[]') ;;
  "GET commits/"*/statuses)
    sha="${rest#commits/}"
    body=$(answer "statuses/${sha%/statuses}.json" '[]') ;;
  "POST statuses/"*)
    sha="${rest#statuses/}"
    mkdir -p "$state/statuses"
    new=$(jq -n --arg state "$(field state)" --arg context "$(field context)" \
      --arg description "$(field description)" --arg url "$(field target_url)" \
      '{state: $state, context: $context, description: $description, target_url: $url}')
    old=$(answer "statuses/${sha}.json" '[]')
    # Newest first, as GitHub lists them.
    jq -n --argjson new "$new" --argjson old "$old" '[$new] + $old' > "$state/statuses/${sha}.json"
    printf '%s %s\n' "$sha" "$(jq -c . <<< "$new")" >> "$state/posted"
    body="$new" ;;
  "GET actions/workflows/sync-waiver.yml/runs") body=$(answer waiver-runs.json '{"workflow_runs":[]}') ;;
  "GET actions/runs/"*/approvals)
    id="${rest#actions/runs/}"
    body=$(answer "approvals/${id%/approvals}.json" '[]') ;;
  "GET environments/sync-waiver") body=$(answer environment.json) ;;
  "GET environments/sync-waiver/deployment-branch-policies"*) body=$(answer branch-policies.json) ;;
  *) echo "stub gh: unexpected call: $method $path" >&2; exit 2 ;;
esac

show() { if [ -n "$filter" ]; then jq -r "$filter" <<< "$1"; else printf '%s\n' "$1"; fi; }
if [ "$method" != "GET" ] || ! jq -e 'type == "array" or (type == "object" and has("workflow_runs"))' <<< "$body" > /dev/null; then
  show "$body"
  exit 0
fi
per=$(field per_page)
[ -n "$per" ] || per=$(printf '%s' "$path" | sed -n 's/.*[?&]per_page=\([0-9]*\).*/\1/p')
[ -n "$per" ] || per=30
page=$(field page)
[ -n "$page" ] || page=1
# One page of a list, or of the list inside the answer.
slice() {
  jq -c --argjson per "$per" --argjson page "$1" \
    'def cut: .[(($page - 1) * $per):($page * $per)]; if type == "array" then cut else .workflow_runs |= cut end' <<< "$body"
}
count() { jq 'if type == "array" then length else (.workflow_runs | length) end' <<< "$1"; }
if [ "$paginate" = 0 ]; then
  show "$(slice "$page")"
  exit 0
fi
while :; do
  part=$(slice "$page")
  if [ "$(count "$part")" = 0 ] && [ "$page" != 1 ]; then break; fi
  show "$part"
  [ "$(count "$part")" = "$per" ] || break
  page=$((page + 1))
done
