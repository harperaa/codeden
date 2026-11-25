#!/usr/bin/env bash
# A stand-in for `gh` in the script tests: a repository's settings kept as files in $GH_STATE,
# every call written to $GH_STATE/log. It knows only the calls the scripts make.
set -euo pipefail
state="${GH_STATE:?}"
printf '%s\n' "$*" >> "$state/log"
[ ! -f "$state/fail-all" ] || { echo "gh: not signed in" >&2; exit 4; }

if [ "$1" = "variable" ]; then
  name="$3"
  if [ "$2" = "get" ]; then
    [ -f "$state/vars/$name" ] || { echo "variable $name was not found" >&2; exit 1; }
    cat "$state/vars/$name"
    exit 0
  fi
  [ ! -f "$state/deny-variables" ] || { echo "HTTP 403: Resource not accessible (admin rights needed)" >&2; exit 1; }
  while [ $# -gt 0 ]; do
    if [ "$1" = "--body" ]; then printf '%s\n' "$2" > "$state/vars/$name"; fi
    shift
  done
  exit 0
fi

[ "$1" = "api" ] || { echo "stub gh: unexpected call: $*" >&2; exit 2; }
shift
method="GET" path="" fields=""
while [ $# -gt 0 ]; do
  case "$1" in
    --method) method="$2"; shift ;;
    --jq) shift ;;
    --raw-field | --field | -f) fields="${fields}$2
"; shift ;;
    --paginate) ;;
    repos/*) path="$1" ;;
    *) echo "stub gh: unexpected argument $1" >&2; exit 2 ;;
  esac
  shift
done
field() { printf '%s' "$fields" | sed -n "s/^$1=//p" | head -n 1; }
rest="${path#repos/*/*/}"
[ "$rest" != "$path" ] || rest=""

case "$method $rest" in
  "GET ")
    printf '%s %s %s %s %s\n' "$(cat "$state/full_name")" "$(cat "$state/default_branch")" \
      "$(cat "$state/has_issues")" true true ;;
  "PATCH ") field default_branch > "$state/default_branch" ;;
  # The release's question about what was merged: this repository has no pull requests.
  "GET pulls" | "GET commits/"*/pulls) ;;
  "GET labels"*) cat "$state/labels" ;;
  "POST labels") field name >> "$state/labels" ;;
  "GET actions/permissions") cat "$state/actions_enabled" ;;
  "PUT actions/permissions") field enabled > "$state/actions_enabled" ;;
  "GET actions/workflows/"*)
    file="$state/workflow-${rest#actions/workflows/}"
    [ -f "$file" ] || { echo "HTTP 404" >&2; exit 1; }
    cat "$file" ;;
  "PUT actions/workflows/"*/enable)
    name="${rest#actions/workflows/}"; echo active > "$state/workflow-${name%/enable}" ;;
  "PUT actions/workflows/"*/disable)
    name="${rest#actions/workflows/}"; echo disabled_manually > "$state/workflow-${name%/disable}" ;;
  *) echo "stub gh: unexpected call: $method $path" >&2; exit 2 ;;
esac
