#!/usr/bin/env bash
# Shows the cooldown on pull requests: asks the rule (scripts/harden/sync-cooldown.sh) about a
# pull request into the working branch and writes the answer on its head commit as the commit
# status "Sync cooldown". Only a pull request that brings upstream commits gets one; any other
# is left alone.
#
# A `sync/...` pull request gets its first status when its clock is running: once it is
# approved ("Cooling down until ..."), over, or waived. Before that it has none. The review
# that has to approve it reads the head's checks, and a status that can't be green before
# the approval must not be among them. A head that already has the status keeps being told
# the truth (on hold, pushed after the approval, the label taken off). Any other branch that
# carries upstream commits gets the status at once: nobody reviews that one as a sync.
#
#   sync-cooldown-report.sh all [--upstream-ref <ref>] [--target-ref <ref>]
#       every open pull request into the working branch. A pull request that can't be
#       evaluated or reported is a warning (`::warning::`), not a failure: it is looked at
#       again on the next run. Exits 2 only when the pull requests can't be listed or
#       upstream can't be fetched, which is the workflow itself being broken.
#   sync-cooldown-report.sh pull-request <number> [--head <sha>] [--upstream-ref <ref>] [--target-ref <ref>]
#       one pull request. Prints the verdict's lines and exits like sync-cooldown.sh does:
#       0 the cooldown is over, waived or does not apply, 1 it is not, 2 it could not be told.
#       A status that could not be written is a warning here: the verdict is what counts.
#
# The "Sync cooldown report" workflow runs it every hour and when a label changes, which is
# how a pull request turns green by itself once its hours are over; the sync workflow's merge
# job runs it for each pull request it is about to merge, so what it merges and what the pull
# request shows come from the same answer.
#
# A status is written only when it differs from the newest one (GitHub keeps at most 1000 per
# commit and name). The status never decides anything here: the rule is asked again each time.
#
# It runs inside a git repository whose `origin` is this repository on GitHub and that has the
# working branch as `refs/sync/target` (the workflows make a bare one). Without --upstream-ref
# it fetches upstream's branch itself (the fork's configuration, scripts/harden/fork-config.sh).
# Pull requests' head commits are fetched as data, for ancestry; nothing of theirs is checked
# out or run. Needs `gh` with a token that may write commit statuses.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/harden/sync-cooldown.sh
. "${script_dir}/sync-cooldown.sh"

mode="${1:-}"
number=""
head=""
upstream_ref=""
target_ref="refs/sync/target"
case "$mode" in
  all) shift ;;
  pull-request) number="${2:-}"; shift 2 || true ;;
  *) sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
while [ $# -gt 0 ]; do
  case "$1" in
    --head) head="${2:-}"; shift ;;
    --upstream-ref) upstream_ref="${2:-}"; shift ;;
    --target-ref) target_ref="${2:-}"; shift ;;
    *) echo "sync-cooldown-report: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
if [ "$mode" = "pull-request" ] && ! [[ "$number" =~ ^[0-9]+$ ]]; then
  echo "sync-cooldown-report: pull-request needs a number" >&2
  exit 2
fi

FORK_CONFIG_WHO="sync-cooldown-report"
# shellcheck source=scripts/harden/fork-config.sh
. "${script_dir}/fork-config.sh"
fork_config_resolve UPSTREAM_REPO UPSTREAM_BRANCH HARDEN_BRANCH
# The repository asked: this clone's origin when it is on GitHub; else SYNC_COOLDOWN_REPO,
# else GITHUB_REPOSITORY.
SYNC_COOLDOWN_REPO="${FORK_REPO:-${SYNC_COOLDOWN_REPO:-}}"
cd_init
if [ -z "$upstream_ref" ]; then
  upstream_ref="refs/sync/upstream"
  if ! git fetch --quiet --no-tags "https://github.com/${UPSTREAM_REPO}" "+refs/heads/${UPSTREAM_BRANCH}:${upstream_ref}"; then
    echo "sync-cooldown-report: couldn't fetch ${UPSTREAM_BRANCH} from ${UPSTREAM_REPO}" >&2
    exit 2
  fi
fi

# Writes the status on commit $1 unless the newest one already says the same. With $5 = update
# it writes only over a status that is already there.
report_status() {
  local sha="$1" state="$2" description="$3" url="$4" only="${5:-}" current
  current=$(cd_gh api --method GET "repos/${CD_REPO}/commits/${sha}/statuses" -f per_page=100 --jq \
    "[.[] | select(.context == \"${STATUS_CONTEXT}\")] | first | if . == null then \"\" else \"\(.state) \(.description)\" end") || return 2
  [ "$current" != "${state} ${description}" ] || return 0
  if [ "$only" = "update" ] && [ -z "$current" ]; then return 0; fi
  if [ -n "$url" ]; then
    cd_gh api --method POST "repos/${CD_REPO}/statuses/${sha}" -f "state=${state}" -f "context=${STATUS_CONTEXT}" \
      -f "description=${description}" -f "target_url=${url}" > /dev/null || return 2
  else
    cd_gh api --method POST "repos/${CD_REPO}/statuses/${sha}" -f "state=${state}" -f "context=${STATUS_CONTEXT}" \
      -f "description=${description}" > /dev/null || return 2
  fi
}

summary() {
  [ -z "${GITHUB_STEP_SUMMARY:-}" ] || printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
}

# Evaluates one pull request and reports it. Returns 2 when it could not be evaluated; a
# status that could not be written sets not_reported instead.
not_reported=0
report_one() {
  local pr="$1" expected="${2:-}" url only=""
  # Its head commit, as data. Already here in a clone that has it (and in the tests).
  if ! cd_read_pull_request "$pr"; then return 2; fi
  if ! git cat-file -e "${PR_HEAD}^{commit}" 2> /dev/null; then
    git fetch --quiet --no-tags origin "$PR_HEAD" 2> /dev/null || true
  fi
  cd_pull_request "$upstream_ref" "$target_ref" "$HARDEN_BRANCH" "$expected" || return 2
  cd_describe
  if [ "$CD_STATE" = "not-a-sync" ] || [ "$PR_STATE" != "open" ]; then return 0; fi
  # The status links to the run that wrote it; a waived one to the approved waiver run.
  url="${CD_WAIVER_URL:-}"
  if [ "$CD_STATE" != "waived" ] || [ -z "$url" ]; then url="${SYNC_COOLDOWN_RUN_URL:-}"; fi
  # A sync branch's first status waits for its clock (see the top of this file).
  case "$PR_HEAD_REF" in
    "${SYNC_HEAD_PREFIX}"*)
      case "$CD_STATE" in waiting | satisfied | waived) ;; *) only="update" ;; esac ;;
  esac
  if ! report_status "$PR_HEAD" "$CD_STATUS" "$CD_SHORT" "$url" "$only"; then
    # The verdict stands; only showing it failed.
    not_reported=1
    echo "sync-cooldown-report: the status of #${PR_NUMBER} couldn't be written: $(cd_problem_text)" >&2
  fi
  summary "- #${PR_NUMBER} \`${PR_HEAD_REF}\`: **${CD_STATUS}**. ${CD_DETAIL} (Upstream commit \`${CD_UPSTREAM}\`, head \`${PR_HEAD}\`.)"
}

if [ "$mode" = "pull-request" ]; then
  if ! report_one "$number" "$head"; then
    cd_print_unknown
    echo "sync-cooldown-report: #${number}: $(cd_problem_text)" >&2
    exit 2
  fi
  cd_print_verdict
  cd_verdict_code
  exit $?
fi

if ! open=$(cd_gh api --paginate "repos/${CD_REPO}/pulls?state=open&base=${HARDEN_BRANCH}&per_page=100" --jq '.[].number'); then
  echo "sync-cooldown-report: the open pull requests couldn't be listed: $(cd_problem_text)" >&2
  exit 2
fi
summary "### ${STATUS_CONTEXT}"
summary ""
count=0
for pr in $open; do
  [[ "$pr" =~ ^[0-9]+$ ]] || continue
  if report_one "$pr"; then
    if [ "$CD_STATE" != "not-a-sync" ]; then
      count=$((count + 1))
      echo "#${pr} ${PR_HEAD_REF} @ ${PR_HEAD}: ${CD_STATE} (${CD_STATUS}). ${CD_DETAIL}"
    fi
  else
    count=$((count + 1))
    echo "::warning::The cooldown of pull request #${pr} could not be evaluated: $(cd_problem_text). It is looked at again on the next run."
    summary "- #${pr}: could not be evaluated: $(cd_problem_text)"
  fi
done
if [ "$not_reported" = 1 ]; then
  echo "::warning::A \"${STATUS_CONTEXT}\" status could not be written (see above). It is tried again on the next run."
fi
if [ "$count" = 0 ]; then
  echo "No open pull request into ${HARDEN_BRANCH} brings upstream commits."
  summary "No open pull request into \`${HARDEN_BRANCH}\` brings upstream commits."
fi
