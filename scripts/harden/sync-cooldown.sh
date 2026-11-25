#!/usr/bin/env bash
# The cooldown of upstream changes: one rule, asked by everything that could ship them
# (docs/codeharden-sync-cooldown.md).
#
# Upstream code reaches users only after it was approved and then waited COOLDOWN_HOURS. This
# file is the only place that decides whether a pull request has done so. It is asked by
#   - the "Sync cooldown report" workflow (sync-cooldown-report.sh), which shows the answer on
#     the pull request as the commit status "Sync cooldown";
#   - the "Upstream sync merge" workflow's merge job, before it merges a sync pull request;
#   - release.sh (sync-cooldown-release.sh), before it cuts a release with new upstream commits.
#
# The rule, for a pull request that brings upstream commits, at a moment T (now for an open
# pull request, the moment of the merge for a merged one). All four hold:
#   1. It has the label `sync-approved` at T. The approval's time is that label's last
#      `labeled` event in the pull request's timeline, not when the pull request was opened.
#   2. It does not have the label `sync-hold` at T.
#   3. The head branch was not pushed to after the approval, and the newest push GitHub has
#      recorded for it is the pull request's head commit. Re-apply the label to start again.
#      GitHub's times are whole seconds: a push in the same second as the approval can't be
#      told from one after it, and counts as after it.
#   4. T is COOLDOWN_HOURS or more after the approval.
# `sync-needs-review` is not part of the rule: it says that a person merges the pull request,
# and they may once the rule holds. (The merge job leaves such a pull request alone.)
#
# Or the owner waived it. A waiver is a successful run of the "Waive sync cooldown" workflow
# on the working branch whose job in the environment `sync-waiver` was approved by someone
# who may waive (GitHub's own record: the run's review history). Who may: the repository's
# owner, or the logins in SYNC_WAIVER_APPROVERS (the repository variable of that name, for a
# repository an organization owns). Its title names the upstream commit, the pull request and
# one commit: the pull request's head or, for upstream commits that arrived without a pull
# request, the commit that brought them in. It covers exactly that: another head, or the
# same upstream commit arriving another way, is not waived.
#
#   sync-cooldown.sh pull-request <number> --upstream-ref <ref> --target-ref <ref> --branch <name> [--head <sha>]
#
# prints the verdict as `key: value` lines (state, status, short, detail, ready, upstream,
# head, url) and exits 0 when the cooldown is over, waived or does not apply, 1 when it is
# not, 2 when GitHub could not be asked (never treat that as a yes). It runs inside a git
# repository that has the pull request's head commit and both refs; it changes nothing.
#
# Sourced by the other sync-cooldown scripts for the functions. Plain bash, also on macOS's
# bash 3.2; needs `git` and `gh`. The repository asked is SYNC_COOLDOWN_REPO, else
# GITHUB_REPOSITORY; the scripts that source this one set it from the clone's origin when
# that is on GitHub. SYNC_COOLDOWN_NOW replaces the clock in tests.
set -euo pipefail

# The one place these are written. A workflow or a script that needs one reads it from here.
COOLDOWN_HOURS=48
APPROVED_LABEL="sync-approved"
HOLD_LABEL="sync-hold"
SYNC_HEAD_PREFIX="sync/"
STATUS_CONTEXT="Sync cooldown"
WAIVER_WORKFLOW="sync-waiver.yml"
WAIVER_WORKFLOW_NAME="Waive sync cooldown"
WAIVER_ENVIRONMENT="sync-waiver"
COOLDOWN_DOCS="docs/codeharden-sync-cooldown.md"

cd_init() {
  CD_REPO="${SYNC_COOLDOWN_REPO:-${GITHUB_REPOSITORY:-}}"
  # Who may waive, lower case, between spaces.
  CD_APPROVERS=" $(cd_lower "${SYNC_WAIVER_APPROVERS:-${CD_REPO%%/*}}") "
  CD_TMP=$(mktemp -d)
  trap 'rm -rf "$CD_TMP"' EXIT
}

# Why GitHub could not be asked. Kept in a file: most calls run inside `$( )`.
cd_problem() { printf '%s\n' "$*" > "$CD_TMP/problem"; }
cd_problem_text() { cat "$CD_TMP/problem" 2> /dev/null || echo "an unknown problem"; }

cd_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# `gh`, with a failure turned into a sentence (and never into an empty answer).
cd_gh() {
  local arg path=""
  for arg in "$@"; do
    case "$arg" in repos/*) path="$arg" ;; esac
  done
  if [ -z "$CD_REPO" ]; then
    cd_problem "this checkout's origin is not a GitHub repository and GITHUB_REPOSITORY is not set, so there is no repository to ask"
    return 2
  fi
  if ! command -v gh > /dev/null 2>&1; then
    cd_problem "the GitHub CLI (gh) is not on PATH"
    return 2
  fi
  if ! gh "$@" 2> "$CD_TMP/gh-error"; then
    cd_problem "GitHub did not answer ${path:-the request} ($(head -n 1 "$CD_TMP/gh-error" | cut -c 1-160))"
    return 2
  fi
}

# Seconds since 1970 of a UTC time as GitHub writes it (`2026-11-23T14:55:33Z`). Anything else
# fails: a time that can't be read is never guessed.
cd_epoch() {
  [[ "$1" =~ ^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?Z$ ]] || return 1
  local y=$((10#${BASH_REMATCH[1]})) m=$((10#${BASH_REMATCH[2]})) d=$((10#${BASH_REMATCH[3]}))
  local rest=$((10#${BASH_REMATCH[4]} * 3600 + 10#${BASH_REMATCH[5]} * 60 + 10#${BASH_REMATCH[6]}))
  if [ "$m" -le 2 ]; then y=$((y - 1)); fi
  local era=$((y / 400))
  local yoe=$((y - era * 400)) doy=$(((153 * ((m + 9) % 12) + 2) / 5 + d - 1))
  echo $(((era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468) * 86400 + rest))
}

# A moment for a person (`2026-11-25 14:55 UTC`) or, with $2 = iso, for a program
# (`2026-11-25T14:55:33Z`).
cd_time() {
  local z=$(($1 / 86400 + 719468)) rest=$(($1 % 86400))
  local era=$((z / 146097))
  local doe=$((z - era * 146097))
  local yoe=$(((doe - doe / 1460 + doe / 36524 - doe / 146096) / 365))
  local doy=$((doe - (365 * yoe + yoe / 4 - yoe / 100)))
  local mp=$(((5 * doy + 2) / 153))
  local d=$((doy - (153 * mp + 2) / 5 + 1)) m=$((mp < 10 ? mp + 3 : mp - 9)) y=$((yoe + era * 400))
  if [ "$m" -le 2 ]; then y=$((y + 1)); fi
  if [ "${2:-}" = "iso" ]; then
    printf '%04d-%02d-%02dT%02d:%02d:%02dZ' "$y" "$m" "$d" $((rest / 3600)) $((rest % 3600 / 60)) $((rest % 60))
  else
    printf '%04d-%02d-%02d %02d:%02d UTC' "$y" "$m" "$d" $((rest / 3600)) $((rest % 3600 / 60))
  fi
}

cd_now() {
  if [ -n "${SYNC_COOLDOWN_NOW:-}" ]; then cd_epoch "$SYNC_COOLDOWN_NOW"; else date -u +%s; fi
}

cd_hours() { # a span in seconds, in words
  local h=$(($1 / 3600))
  if [ "$h" -lt 1 ]; then echo "less than an hour"; elif [ "$h" = 1 ]; then echo "1 hour"; else echo "${h} hours"; fi
}

# The pull request, as PR_* variables.
cd_read_pull_request() {
  local out
  out=$(cd_gh api "repos/${CD_REPO}/pulls/$1" --jq "
    .number, .state, (.merged_at // \"-\"), .head.sha, .head.ref, (.head.repo.full_name // \"-\"),
    .base.ref, any(.labels[]; .name == \"${APPROVED_LABEL}\"), any(.labels[]; .name == \"${HOLD_LABEL}\")") || return 2
  {
    read -r PR_NUMBER
    read -r PR_STATE
    read -r PR_MERGED_AT
    read -r PR_HEAD
    read -r PR_HEAD_REF
    read -r PR_HEAD_REPO
    read -r PR_BASE
    read -r PR_HAS_APPROVED
    read -r PR_HAS_HOLD
  } <<< "$out" || true
  if ! [[ "${PR_NUMBER:-}" =~ ^[0-9]+$ && "${PR_HEAD:-}" =~ ^[0-9a-f]{40}$ && -n "${PR_HAS_HOLD:-}" ]]; then
    cd_problem "pull request #$1 came back from GitHub in a shape this script does not know"
    return 2
  fi
}

# The two labels at moment $2, from the timeline's `labeled` and `unlabeled` events: sets
# CD_APPROVED_AT (when `sync-approved` was last applied; empty when it is not on) and CD_HELD.
cd_labels_at() {
  local events when event name s approved_at="" approved="" hold_at="" hold=""
  events=$(cd_gh api --paginate "repos/${CD_REPO}/issues/$1/timeline?per_page=100" --jq \
    '.[] | select(.event == "labeled" or .event == "unlabeled") | "\(.created_at) \(.event) \(.label.name)"') || return 2
  while read -r when event name; do
    [ -n "$when" ] || continue
    if ! s=$(cd_epoch "$when"); then
      cd_problem "a label event of pull request #$1 has a time this script can't read (${when})"
      return 2
    fi
    [ "$s" -le "$2" ] || continue
    # Events come oldest first; at the same second the later one counts.
    if [ "$name" = "$APPROVED_LABEL" ] && { [ -z "$approved_at" ] || [ "$s" -ge "$approved_at" ]; }; then
      approved_at="$s" approved="$event"
    elif [ "$name" = "$HOLD_LABEL" ] && { [ -z "$hold_at" ] || [ "$s" -ge "$hold_at" ]; }; then
      hold_at="$s" hold="$event"
    fi
  done <<< "$events"
  CD_APPROVED_AT="" CD_HELD=0
  if [ "$approved" = "labeled" ]; then CD_APPROVED_AT="$approved_at"; fi
  if [ "$hold" = "labeled" ]; then CD_HELD=1; fi
}

# The newest push to branch $1 at or before moment $2, from the repository's activity log:
# sets CD_PUSH_AT and CD_PUSH_SHA (empty when GitHub has no record). Creating the branch, a
# forced push and a merge into it are pushes; deleting it is not.
cd_last_push() {
  local rows when type after s
  rows=$(cd_gh api --paginate --method GET "repos/${CD_REPO}/activity" -f "ref=refs/heads/$1" -f per_page=100 --jq \
    '.[] | "\(.timestamp) \(.activity_type) \(.after)"') || return 2
  CD_PUSH_AT="" CD_PUSH_SHA=""
  while read -r when type after; do
    [ -n "$when" ] || continue
    [ "$type" != "branch_deletion" ] || continue
    if ! s=$(cd_epoch "$when"); then
      cd_problem "a push to $1 has a time this script can't read (${when})"
      return 2
    fi
    [ "$s" -le "$2" ] || continue
    # Rows come newest first; at the same second the first one counts.
    if [ -z "$CD_PUSH_AT" ] || [ "$s" -gt "$CD_PUSH_AT" ]; then CD_PUSH_AT="$s" CD_PUSH_SHA="$after"; fi
  done <<< "$rows"
}

# The title of the run that waives upstream commit $1 for pull request $2 (or for none) at
# commit $3.
cd_waiver_title() {
  printf '%s: upstream %s, pull request %s, commit %s' "$WAIVER_WORKFLOW_NAME" "$1" "${2:-none}" "$3"
}

# Whether one of the logins in $1 (one per line) may waive: prints the first that may.
cd_may_waive() {
  local login
  while read -r login; do
    [ -n "$login" ] || continue
    case "$CD_APPROVERS" in *" $(cd_lower "$login") "*) printf '%s\n' "$login"; return 0 ;; esac
  done <<< "$1"
  return 1
}

# The owner's waiver for upstream commit $1 brought by pull request $2 (empty: by none) at
# commit $3. Sets CD_WAIVER_AT (when the run started), CD_WAIVER_BY (who approved it) and
# CD_WAIVER_URL; returns 1 when there is none. A waiver that can't be read is no waiver.
cd_find_waiver() {
  local wanted runs id started branch url title by
  CD_WAIVER_AT="" CD_WAIVER_BY="" CD_WAIVER_URL=""
  wanted=$(cd_waiver_title "$1" "$2" "$3")
  runs=$(cd_gh api --paginate --method GET "repos/${CD_REPO}/actions/workflows/${WAIVER_WORKFLOW}/runs" \
    -f event=workflow_dispatch -f status=success -f per_page=100 --jq \
    '.workflow_runs[] | select(.conclusion == "success") | "\(.id) \(.run_started_at) \(.head_branch) \(.html_url) \(.display_title)"') || return 1
  while read -r id started branch url title; do
    [ -n "$id" ] || continue
    [ "$branch" = "$CD_BRANCH" ] && [ "$title" = "$wanted" ] || continue
    [[ "$id" =~ ^[0-9]+$ ]] || continue
    # The proof: someone who may waive approved this run's job in the waiver environment.
    by=$(cd_gh api "repos/${CD_REPO}/actions/runs/${id}/approvals" --jq \
      ".[] | select(.state == \"approved\" and any(.environments[]; .name == \"${WAIVER_ENVIRONMENT}\")) | .user.login") || continue
    by=$(cd_may_waive "$by") || continue
    CD_WAIVER_AT=$(cd_epoch "$started") || continue
    CD_WAIVER_BY="$by" CD_WAIVER_URL="$url"
    return 0
  done <<< "$runs"
  return 1
}

# The rule. Needs PR_* (cd_read_pull_request) and CD_BRANCH; $1 is the upstream commit the pull
# request brings (empty when unknown: then no waiver can match). Sets CD_STATE and the facts
# the sentences use: CD_AT, CD_APPROVED_AT, CD_READY_AT, CD_PUSH_AT, CD_WAIVER_*.
cd_evaluate() {
  local upstream="$1" merged=0 foreign=0 settled=0
  CD_STATE="" CD_READY_AT="" CD_PUSH_AT="" CD_PUSH_SHA="" CD_WAIVER_AT="" CD_WAIVER_BY="" CD_WAIVER_URL=""
  if [ "$PR_MERGED_AT" != "-" ]; then
    merged=1
    if ! CD_AT=$(cd_epoch "$PR_MERGED_AT"); then
      cd_problem "pull request #${PR_NUMBER}'s merge time can't be read (${PR_MERGED_AT})"
      return 2
    fi
  elif ! CD_AT=$(cd_now); then
    cd_problem "the clock can't be read"
    return 2
  fi
  cd_labels_at "$PR_NUMBER" "$CD_AT" || return 2
  if [ "$merged" = 0 ]; then
    # An open pull request: the labels it has right now count as well.
    [ "$PR_HAS_APPROVED" = "true" ] || CD_APPROVED_AT=""
    [ "$PR_HAS_HOLD" != "true" ] || CD_HELD=1
  fi
  if [ "$(cd_lower "$PR_HEAD_REPO")" != "$(cd_lower "$CD_REPO")" ]; then
    foreign=1
  else
    cd_last_push "$PR_HEAD_REF" "$CD_AT" || return 2
    if [ -n "$CD_PUSH_AT" ] && [ "$CD_PUSH_SHA" = "$PR_HEAD" ]; then settled=1; fi
  fi
  if [ -n "$CD_APPROVED_AT" ]; then CD_READY_AT=$((CD_APPROVED_AT + COOLDOWN_HOURS * 3600)); fi

  if [ "$foreign" = 1 ]; then
    CD_STATE="foreign"
  elif [ "$settled" = 0 ]; then
    CD_STATE="unsettled"
  elif [ "$CD_HELD" = 1 ]; then
    CD_STATE="held"
  elif [ -z "$CD_APPROVED_AT" ]; then
    CD_STATE="not-approved"
  elif [ "$CD_PUSH_AT" -ge "$CD_APPROVED_AT" ]; then
    # In the same second or later: the approval can't be shown to cover this head.
    CD_STATE="head-moved" CD_READY_AT=""
  elif [ "$CD_AT" -lt "$CD_READY_AT" ]; then
    CD_STATE="waiting"
  else
    CD_STATE="satisfied"
  fi

  # The only way around: the owner's waiver for this upstream commit at exactly this head.
  if [ "$CD_STATE" != "satisfied" ] && [ -n "$upstream" ] && cd_find_waiver "$upstream" "$PR_NUMBER" "$PR_HEAD"; then
    CD_STATE="waived"
  fi
}

# What the status on an open pull request says: CD_STATUS (success, pending or failure),
# CD_SHORT (the status line, 140 characters at most) and CD_DETAIL.
cd_describe() {
  local h="$COOLDOWN_HOURS" approved="" ready="" pushed="" waived="" ends="end" after="after"
  # Said on every status that is not green: it is a clock, and nobody is to wait for it.
  local hint="Not a CI check."
  [ -z "${CD_APPROVED_AT:-}" ] || approved=$(cd_time "$CD_APPROVED_AT")
  [ -z "${CD_READY_AT:-}" ] || ready=$(cd_time "$CD_READY_AT")
  [ -z "${CD_PUSH_AT:-}" ] || pushed=$(cd_time "$CD_PUSH_AT")
  [ -z "${CD_WAIVER_AT:-}" ] || waived=$(cd_time "$CD_WAIVER_AT")
  if [ -n "${CD_READY_AT:-}" ] && [ "$CD_AT" -ge "$CD_READY_AT" ]; then ends="ended"; fi
  if [ "${CD_PUSH_AT:-}" = "${CD_APPROVED_AT:-}" ]; then after="in the same second as"; fi
  CD_STATUS="pending"
  case "$CD_STATE" in
    not-a-sync)
      CD_STATUS="success"
      CD_SHORT="No new upstream commits: the cooldown does not apply."
      CD_DETAIL="This pull request brings no upstream commit that ${CD_BRANCH} doesn't already have, so the ${h}-hour cooldown does not apply to it." ;;
    satisfied)
      CD_STATUS="success"
      CD_SHORT="Cooldown over: approved ${approved}, ${h} hours passed, nothing pushed since."
      CD_DETAIL="${APPROVED_LABEL} was applied ${approved}, ${h} hours have passed and the head branch was not pushed to since. The cooldown is over." ;;
    waived)
      CD_STATUS="success"
      CD_SHORT="Cooldown waived by the owner (approved by ${CD_WAIVER_BY}, ${waived})."
      CD_DETAIL="The ${h}-hour cooldown was waived by the owner for upstream ${CD_UPSTREAM:0:8} at this head: ${CD_WAIVER_BY} approved the run that started ${waived} (${CD_WAIVER_URL})." ;;
    waiting)
      CD_SHORT="Cooling down until ${ready} (approved ${approved}). Expected. ${hint}"
      CD_DETAIL="${APPROVED_LABEL} was applied ${approved}. The ${h} hours end ${ready}; this turns green by itself within the hour after that, unless something is pushed or ${HOLD_LABEL} is added." ;;
    not-approved)
      CD_SHORT="Not approved yet: the ${h} hours start when ${APPROVED_LABEL} is applied. ${hint}"
      CD_DETAIL="This pull request brings upstream commits and does not have the label ${APPROVED_LABEL}. The ${h} hours start when the label is applied." ;;
    held)
      CD_SHORT="On hold (label ${HOLD_LABEL})."
      CD_DETAIL="The label ${HOLD_LABEL} is on this pull request, so it is not to be merged."
      if [ -n "$ready" ]; then
        CD_SHORT="${CD_SHORT} The ${h} hours since the approval ${ends} ${ready}."
        CD_DETAIL="${CD_DETAIL} ${APPROVED_LABEL} was applied ${approved}; the ${h} hours ${ends} ${ready} and keep running while it is on hold."
      fi
      CD_SHORT="${CD_SHORT} ${hint}" ;;
    head-moved)
      CD_STATUS="failure"
      CD_SHORT="Pushed ${pushed}, ${after} the approval (${approved}). Re-apply ${APPROVED_LABEL}. ${hint}"
      CD_DETAIL="The head branch was pushed ${pushed}, ${after} ${APPROVED_LABEL} was applied (${approved}): the approval covers the commit that was reviewed, not a later one. Review it again and re-apply the label; the ${h} hours start over." ;;
    unsettled)
      CD_SHORT="GitHub's push record is not at this head yet; looked at again within the hour. ${hint}"
      CD_DETAIL="The newest push GitHub has recorded for ${PR_HEAD_REF} (${CD_PUSH_SHA:-none}) is not this pull request's head (${PR_HEAD}), so it can't be shown that nothing was pushed after the approval. It is looked at again on the next run." ;;
    foreign)
      CD_STATUS="failure"
      CD_SHORT="The head branch is in another repository; its pushes can't be read. A person decides. ${hint}"
      CD_DETAIL="The head branch is in ${PR_HEAD_REPO}, not in ${CD_REPO}, so its pushes can't be read and the cooldown can't be shown to hold." ;;
  esac
  CD_SHORT="${CD_SHORT:0:140}"
}

# The verdict for the pull request that was read (PR_*), into branch $3, with the refs that
# hold upstream ($1) and that branch ($2). $4, when given, is the head the caller saw.
cd_pull_request() {
  local upstream_ref="$1" target_ref="$2" expected="${4:-}"
  CD_BRANCH="$3" CD_UPSTREAM="" CD_AT="" CD_APPROVED_AT="" CD_READY_AT="" CD_PUSH_AT="" CD_WAIVER_AT=""
  if [ "$PR_BASE" != "$CD_BRANCH" ]; then
    CD_STATE="not-a-sync"
    return 0
  fi
  if [ -n "$expected" ] && [ "$expected" != "$PR_HEAD" ]; then
    cd_problem "pull request #${PR_NUMBER}'s head changed while it was being looked at (${expected} is now ${PR_HEAD})"
    return 2
  fi
  if ! git cat-file -e "${PR_HEAD}^{commit}" 2> /dev/null; then
    cd_problem "the head commit of pull request #${PR_NUMBER} (${PR_HEAD}) is not in this clone"
    return 2
  fi
  # A sync by its branch name, or by what it carries: upstream commits the branch lacks.
  CD_UPSTREAM=$(git merge-base "$PR_HEAD" "$upstream_ref" 2> /dev/null) || CD_UPSTREAM=""
  case "$PR_HEAD_REF" in
    "${SYNC_HEAD_PREFIX}"*) ;;
    *)
      if [ -z "$CD_UPSTREAM" ] || git merge-base --is-ancestor "$CD_UPSTREAM" "$target_ref" 2> /dev/null; then
        CD_STATE="not-a-sync"
        return 0
      fi ;;
  esac
  cd_evaluate "$CD_UPSTREAM"
}

cd_print_verdict() {
  local ready=""
  if [ "$CD_STATE" = "waiting" ]; then ready=$(cd_time "$CD_READY_AT" iso); fi
  printf 'state: %s\nstatus: %s\nshort: %s\ndetail: %s\nready: %s\nupstream: %s\nhead: %s\nurl: %s\n' \
    "$CD_STATE" "$CD_STATUS" "$CD_SHORT" "$CD_DETAIL" "$ready" "${CD_UPSTREAM:-}" "${PR_HEAD:-}" "${CD_WAIVER_URL:-}"
}

# The verdict could not be reached: said as a verdict, so a caller that reads only the lines
# can't take it for a yes.
cd_print_unknown() {
  printf 'state: unknown\nstatus: error\nshort: %s\ndetail: %s\nready: \nupstream: \nhead: %s\nurl: \n' \
    "The cooldown could not be evaluated; see the run." "The cooldown could not be evaluated: $(cd_problem_text)." "${PR_HEAD:-}"
}

cd_verdict_code() {
  case "$CD_STATE" in satisfied | waived | not-a-sync) return 0 ;; *) return 1 ;; esac
}

cd_main() {
  local number="" upstream_ref="" target_ref="" branch="" head=""
  [ "${1:-}" = "pull-request" ] || { sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
  number="${2:-}"
  shift 2 || true
  while [ $# -gt 0 ]; do
    case "$1" in
      --upstream-ref) upstream_ref="${2:-}"; shift ;;
      --target-ref) target_ref="${2:-}"; shift ;;
      --branch) branch="${2:-}"; shift ;;
      --head) head="${2:-}"; shift ;;
      *) echo "sync-cooldown: unknown option $1" >&2; exit 2 ;;
    esac
    shift
  done
  if ! [[ "$number" =~ ^[0-9]+$ ]] || [ -z "$upstream_ref" ] || [ -z "$target_ref" ] || [ -z "$branch" ]; then
    echo "sync-cooldown: pull-request needs a number, --upstream-ref, --target-ref and --branch" >&2
    exit 2
  fi
  cd_init
  if ! cd_read_pull_request "$number" || ! cd_pull_request "$upstream_ref" "$target_ref" "$branch" "$head"; then
    cd_print_unknown
    exit 2
  fi
  cd_describe
  cd_print_verdict
  cd_verdict_code
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then cd_main "$@"; fi
