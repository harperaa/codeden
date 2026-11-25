#!/usr/bin/env bash
# The quarantine of upstream commits: which upstream commit may be synced now?
# (docs/codeharden-sync-cooldown.md, "The quarantine: 48 hours before a sync").
#
# No upstream commit is fetched, installed, built or tested before it has been on upstream's
# branch for QUARANTINE_HOURS (scripts/harden/sync-cooldown.sh has the number, beside the
# cooldown's). This file is the only place that decides it, and it decides it without taking
# any upstream code. It asks GitHub two things about upstream's branch, both metadata, and
# compares commit ids with what this clone already has:
#   - where the branch is now:         GET /repos/<upstream>/git/ref/heads/<branch>
#   - when each update of it happened: GET /repos/<upstream>/activity?ref=refs/heads/<branch>
# It downloads no file of upstream's, starts no transfer of git objects and runs nothing.
#
# How old a commit is. Not its author or committer date: whoever makes a commit writes those,
# so a backdated commit would pass. What counts is when GitHub recorded the update of
# upstream's branch that brought the commit there (the activity's `timestamp`). The newest
# update that is QUARANTINE_HOURS old or older left the branch at one commit; that commit and
# everything in its history have been public on the branch at least that long. It is the
# newest commit out of quarantine, whether or not it is still the tip: a sync takes upstream
# up to it and leaves the newer commits for a later day.
#
# When the answer is not a yes:
#   - Anything but an ordinary push inside the quarantine (a forced push, the branch deleted
#     or created) means the history was rewritten: nothing is eligible until that update is
#     QUARANTINE_HOURS old, and it is said as a finding.
#   - When GitHub can't be asked, answers in a shape this script does not know, has no update
#     old enough on record, or its record does not fit together (it is not at the branch's
#     tip, or an update is missing between two others), the answer is `unknown`. Never treat
#     that as a yes.
#
#   upstream-eligible.sh latest [--target-ref <ref>]
#       the newest upstream commit out of quarantine that the working branch does not contain.
#   upstream-eligible.sh check <commit> [--target-ref <ref>]
#       whether that commit is out of quarantine: it is the newest such commit, or in its
#       history. The history is read from this clone, so the newest commit out of quarantine
#       (the line `newest`) has to be here; taking exactly that commit by its id is allowed.
#
# Both print `key: value` lines (state, short, commit, newest, pushed, tip, next, finding,
# detail) and exit 0 on `eligible`, 1 when the answer is no (latest: `none`, `up-to-date`,
# `rewritten`; check: `not-eligible`, `rewritten`) and 2 on `unknown`. Read the `state` line;
# a run that prints none is an `unknown`.
#   commit   latest: the commit to sync up to; check: the commit asked about. Empty unless
#            the state is `eligible`.
#   newest   the newest commit out of quarantine, also when the working branch has it.
#   pushed   when GitHub recorded the update that put `newest` at the branch's tip.
#   next     when the next commit comes out of quarantine; empty when none is waiting.
#   finding  a rewrite of upstream's history, for the owner; empty when there is none.
#
# Using the answer. `commit` is empty on every answer but `eligible`, and an empty argument
# is not harmless to git: `git fetch <url> ""` fetches the remote's HEAD (upstream's newest
# commit) and `git push <remote> "":<ref>` deletes that ref. So a caller never pipes this
# script straight into a variable it then hands to git: that also loses the exit status. It
# keeps the output, and goes on only when the exit status is 0, the `state` line is exactly
# `eligible` and `commit` is a full id of 40 lowercase hexadecimal characters. The README's
# steps by hand do exactly that, and upstream-eligible-readme.test.mjs runs them.
#
# --target-ref is the working branch as this clone has it (default: `origin`'s
# remote-tracking ref of HARDEN_BRANCH); update that one branch from origin first. It runs
# inside a full clone (not a shallow one) and changes nothing. Which upstream and which
# branch: the fork's configuration (scripts/harden/fork-config.sh). Needs `git` and `gh`,
# signed in. Plain bash, also on macOS's bash 3.2. The clock is the machine's;
# SYNC_COOLDOWN_NOW replaces it in tests, as it does for the cooldown. No option and no
# variable shortens the wait.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/harden/sync-cooldown.sh
. "${script_dir}/sync-cooldown.sh"

mode="${1:-}"
asked=""
target_ref=""
case "$mode" in
  latest) shift ;;
  check) asked="${2:-}"; shift 2 || true ;;
  *) sed -n '2,63p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
while [ $# -gt 0 ]; do
  case "$1" in
    --target-ref) target_ref="${2:-}"; shift ;;
    *) echo "upstream-eligible: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
if [ "$mode" = "check" ] && ! [[ "$asked" =~ ^[0-9a-f]{40}$ ]]; then
  echo "upstream-eligible: check needs a full commit id" >&2
  exit 2
fi

UE_STATE="" UE_SHORT="" UE_DETAIL="" UE_COMMIT="" UE_NEWEST="" UE_TIP="" UE_FINDING=""
UE_PUSHED_AT="" UE_NEXT_AT="" UE_WAITING=0 UE_ASKED_AT="" UE_REWRITE=""
UE_ANSWERED=0

ue_print() {
  local pushed="" next=""
  [ -z "$UE_PUSHED_AT" ] || pushed=$(cd_time "$UE_PUSHED_AT" iso)
  [ -z "$UE_NEXT_AT" ] || next=$(cd_time "$UE_NEXT_AT" iso)
  UE_ANSWERED=1
  printf 'state: %s\nshort: %s\ncommit: %s\nnewest: %s\npushed: %s\ntip: %s\nnext: %s\nfinding: %s\ndetail: %s\n' \
    "$UE_STATE" "$UE_SHORT" "$UE_COMMIT" "$UE_NEWEST" "$pushed" "$UE_TIP" "$next" "$UE_FINDING" "$UE_DETAIL"
}

# Whatever ends this script, it never ends without an answer: a failure nobody expected is an
# `unknown`, not a silent no and never a yes.
ue_on_exit() {
  local code=$?
  set +e
  if [ "$UE_ANSWERED" = 0 ]; then
    printf 'state: unknown\nshort: %s\ncommit: \nnewest: \npushed: \ntip: \nnext: \nfinding: \ndetail: %s\n' \
      "The quarantine could not be evaluated; nothing is eligible." \
      "The quarantine could not be evaluated: the script stopped before it had an answer (exit ${code})."
    code=2
  fi
  [ -z "${CD_TMP:-}" ] || rm -rf "$CD_TMP"
  exit "$code"
}
trap ue_on_exit EXIT

# The fork's configuration. A value that is missing or malformed stops fork-config.sh with an
# exit of its own, which must not read as an answer: it is resolved in a subshell.
FORK_CONFIG_WHO="upstream-eligible"
# shellcheck source=scripts/harden/fork-config.sh
. "${script_dir}/fork-config.sh"
UPSTREAM_REPO="${UPSTREAM_REPO:-}" UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-}" HARDEN_BRANCH="${HARDEN_BRANCH:-}"
if ! config=$(fork_config_resolve UPSTREAM_REPO UPSTREAM_BRANCH HARDEN_BRANCH \
  && printf '%s\n%s\n%s\n' "$UPSTREAM_REPO" "$UPSTREAM_BRANCH" "$HARDEN_BRANCH"); then
  config=""
fi
{
  read -r UPSTREAM_REPO
  read -r UPSTREAM_BRANCH
  read -r HARDEN_BRANCH
} <<< "$config" || true
[ -n "$target_ref" ] || target_ref="refs/remotes/origin/${HARDEN_BRANCH}"
cd_init
trap ue_on_exit EXIT
# Every question below is about upstream's repository.
CD_REPO="$UPSTREAM_REPO"

# Whether commit $1 is in the working branch as this clone has it. A commit that is not in
# this clone is not in the branch.
ue_contained() {
  git cat-file -e "$1^{commit}" 2> /dev/null && git merge-base --is-ancestor "$1" "$target_ref" 2> /dev/null
}

ue_ordinary() {
  case "$1" in push | pr_merge | merge_queue_merge) return 0 ;; *) return 1 ;; esac
}

# Where upstream's branch is now: sets UE_TIP.
ue_read_tip() {
  local out ref="" type="" sha=""
  out=$(cd_gh api "repos/${UPSTREAM_REPO}/git/ref/heads/${UPSTREAM_BRANCH}" --jq '"\(.ref) \(.object.type) \(.object.sha)"') || return 2
  read -r ref type sha <<< "$out" || true
  if [ "$ref" != "refs/heads/${UPSTREAM_BRANCH}" ] || [ "$type" != "commit" ] || ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    cd_problem "the branch ${UPSTREAM_BRANCH} of ${UPSTREAM_REPO} came back from GitHub in a shape this script does not know"
    return 2
  fi
  UE_TIP="$sha"
}

# The updates of upstream's branch as GitHub recorded them, newest first, into UE_AT (seconds),
# UE_TYPE, UE_BEFORE and UE_AFTER; UE_N is how many. $1 = page: the newest hundred. $1 = week:
# every one of the past seven days, for a branch with more than a hundred inside the quarantine.
# Each field is checked before it is used: what GitHub returns is data.
UE_ROW='.[] | "\(.timestamp) \(.activity_type) \(.before) \(.after) \(.ref)"'
ue_read_rows() {
  local rows when type before after ref extra s last=""
  if [ "$1" = "week" ]; then
    rows=$(cd_gh api --paginate --method GET "repos/${UPSTREAM_REPO}/activity" -f "ref=refs/heads/${UPSTREAM_BRANCH}" \
      -f direction=desc -f per_page=100 -f time_period=week --jq "$UE_ROW") || return 2
  else
    rows=$(cd_gh api --method GET "repos/${UPSTREAM_REPO}/activity" -f "ref=refs/heads/${UPSTREAM_BRANCH}" \
      -f direction=desc -f per_page=100 --jq "$UE_ROW") || return 2
  fi
  UE_N=0
  UE_AT=() UE_TYPE=() UE_BEFORE=() UE_AFTER=()
  while read -r when type before after ref extra; do
    [ -n "$when" ] || continue
    if ! s=$(cd_epoch "$when") || ! [[ "$type" =~ ^[a-z_]+$ && "$before" =~ ^[0-9a-f]{40}$ && "$after" =~ ^[0-9a-f]{40}$ ]] \
      || [ "$ref" != "refs/heads/${UPSTREAM_BRANCH}" ] || [ -n "$extra" ]; then
      cd_problem "an update of ${UPSTREAM_BRANCH} (${UPSTREAM_REPO}) came back from GitHub in a shape this script does not know"
      return 2
    fi
    if [ -n "$last" ] && [ "$s" -gt "$last" ]; then
      cd_problem "GitHub's record of ${UPSTREAM_BRANCH} (${UPSTREAM_REPO}) did not come back newest first"
      return 2
    fi
    last="$s"
    UE_AT[UE_N]="$s" UE_TYPE[UE_N]="$type" UE_BEFORE[UE_N]="$before" UE_AFTER[UE_N]="$after"
    UE_N=$((UE_N + 1))
  done <<< "$rows"
}

# The rule. Sets UE_STATE and the facts the sentences use.
ue_evaluate() {
  local now cutoff scope i=0 k broken="" span=$((QUARANTINE_HOURS * 3600))
  if [ -z "$UPSTREAM_REPO" ] || [ -z "$UPSTREAM_BRANCH" ] || [ -z "$HARDEN_BRANCH" ]; then
    cd_problem "the fork's configuration could not be read (UPSTREAM_REPO, UPSTREAM_BRANCH, HARDEN_BRANCH; see the message above)"
    return 2
  fi
  if ! git rev-parse --git-dir > /dev/null 2>&1; then
    cd_problem "this folder is not inside a repository"
    return 2
  fi
  if [ "$(git rev-parse --is-shallow-repository 2> /dev/null)" != "false" ]; then
    cd_problem "this clone is shallow, so what the working branch contains can't be read from it"
    return 2
  fi
  if ! git rev-parse --verify --quiet "${target_ref}^{commit}" > /dev/null; then
    cd_problem "the working branch is not in this clone as ${target_ref}; update it from origin first"
    return 2
  fi
  if ! now=$(cd_now); then
    cd_problem "the clock can't be read"
    return 2
  fi
  cutoff=$((now - span))
  ue_read_tip || return 2
  if [ "$mode" = "latest" ] && ue_contained "$UE_TIP"; then
    UE_STATE="up-to-date"
    return 0
  fi

  for scope in page week; do
    ue_read_rows "$scope" || return 2
    if [ "$UE_N" = 0 ]; then
      cd_problem "GitHub has no record of an update of ${UPSTREAM_BRANCH} (${UPSTREAM_REPO})"
      return 2
    fi
    if [ "${UE_AFTER[0]}" != "$UE_TIP" ]; then
      cd_problem "GitHub's record of ${UPSTREAM_BRANCH} (${UPSTREAM_REPO}) is not at the branch's tip (the tip is ${UE_TIP}, the newest update on record ends at ${UE_AFTER[0]}); ask again in a few minutes"
      return 2
    fi
    # The updates inside the quarantine, newest first; i ends at the newest one outside it.
    i=0 broken="" UE_REWRITE=""
    while [ "$i" -lt "$UE_N" ] && [ "${UE_AT[$i]}" -gt "$cutoff" ]; do
      if ! ue_ordinary "${UE_TYPE[$i]}" && [ -z "$UE_REWRITE" ]; then UE_REWRITE="$i"; fi
      # Each update starts where the one before it ended, or one is missing from the record.
      k=$((i + 1))
      if [ "$k" -lt "$UE_N" ] && [ "${UE_BEFORE[$i]}" != "${UE_AFTER[$k]}" ] && [ -z "$broken" ]; then broken="$i"; fi
      i="$k"
    done
    if [ -n "$UE_REWRITE" ]; then
      UE_STATE="rewritten"
      UE_NEXT_AT=$((UE_AT[UE_REWRITE] + span))
      return 0
    fi
    if [ "$i" -lt "$UE_N" ]; then break; fi
    # A full page that is all inside the quarantine: a very busy branch. Ask for the week.
    if [ "$scope" = "page" ] && [ "$UE_N" -ge 100 ]; then continue; fi
    cd_problem "GitHub's record of ${UPSTREAM_BRANCH} (${UPSTREAM_REPO}) has no update that is ${QUARANTINE_HOURS} hours old or older, so no commit can be shown to have been there that long"
    return 2
  done
  if [ -n "$broken" ]; then
    cd_problem "GitHub's record of ${UPSTREAM_BRANCH} (${UPSTREAM_REPO}) does not fit together: the update of $(cd_time "${UE_AT[$broken]}") does not start where the one before it ended"
    return 2
  fi

  UE_NEWEST="${UE_AFTER[$i]}" UE_PUSHED_AT="${UE_AT[$i]}" UE_WAITING="$i"
  if [ "$i" -gt 0 ]; then UE_NEXT_AT=$((UE_AT[i - 1] + span)); fi
  # A rewrite that is itself out of quarantine, since what the working branch has: allowed,
  # and still said.
  k="$i"
  while [ "$k" -lt "$UE_N" ] && ! ue_contained "${UE_AFTER[$k]}"; do
    if ! ue_ordinary "${UE_TYPE[$k]}"; then
      UE_FINDING="The history of ${UPSTREAM_BRANCH} (${UPSTREAM_REPO}) was rewritten $(cd_time "${UE_AT[$k]}") (${UE_TYPE[$k]}: ${UE_BEFORE[$k]} became ${UE_AFTER[$k]}). That is ${QUARANTINE_HOURS} hours ago or more, so the quarantine allows what came of it, but the working branch may hold commits that are no longer upstream's. Tell the owner."
      break
    fi
    k=$((k + 1))
  done

  if [ "$mode" = "latest" ]; then
    if ue_contained "$UE_NEWEST"; then
      UE_STATE="none"
    else
      UE_STATE="eligible" UE_COMMIT="$UE_NEWEST"
    fi
    return 0
  fi
  if [ "$asked" = "$UE_NEWEST" ]; then
    UE_STATE="eligible" UE_COMMIT="$asked"
  elif ! git cat-file -e "${UE_NEWEST}^{commit}" 2> /dev/null; then
    cd_problem "the newest commit out of quarantine (${UE_NEWEST}) is not in this clone, so its history can't be read. Take exactly that commit by its id from upstream (it is out of quarantine, nothing newer is) and ask again"
    return 2
  elif git cat-file -e "${asked}^{commit}" 2> /dev/null && git merge-base --is-ancestor "$asked" "$UE_NEWEST" 2> /dev/null; then
    UE_STATE="eligible" UE_COMMIT="$asked"
  else
    UE_STATE="not-eligible"
    k=0
    while [ "$k" -lt "$i" ]; do
      if [ "${UE_AFTER[$k]}" = "$asked" ]; then UE_ASKED_AT=$((UE_AT[k] + span)); fi
      k=$((k + 1))
    done
  fi
}

# The sentences: UE_SHORT and UE_DETAIL (and UE_FINDING for a rewrite inside the quarantine).
ue_describe() {
  local h="$QUARANTINE_HOURS" where="${UPSTREAM_BRANCH} (${UPSTREAM_REPO})" pushed="" next="" waiting="" r
  [ -z "$UE_PUSHED_AT" ] || pushed=$(cd_time "$UE_PUSHED_AT")
  [ -z "$UE_NEXT_AT" ] || next=$(cd_time "$UE_NEXT_AT")
  if [ "$UE_WAITING" = 1 ]; then
    waiting=" 1 newer update is still in quarantine and comes out ${next}."
  elif [ "$UE_WAITING" -gt 1 ]; then
    waiting=" ${UE_WAITING} newer updates are still in quarantine; the first comes out ${next}."
  fi
  case "$UE_STATE" in
    eligible)
      if [ "$mode" = "latest" ]; then
        UE_SHORT="Upstream ${UE_COMMIT:0:8} is out of quarantine: on ${UPSTREAM_BRANCH} since ${pushed}.${waiting}"
        UE_DETAIL="GitHub recorded the update that left ${where} at ${UE_COMMIT} ${pushed}, ${h} hours ago or more, and only ordinary pushes since. A sync takes upstream up to this commit: take exactly this commit by its id, and nothing newer.${waiting}"
      else
        UE_SHORT="Upstream ${UE_COMMIT:0:8} is out of quarantine."
        UE_DETAIL="${UE_COMMIT} is the newest commit out of quarantine or in its history: ${where} was left at ${UE_NEWEST} ${pushed}, ${h} hours ago or more, with only ordinary pushes since."
      fi ;;
    none)
      UE_SHORT="No upstream commit is out of quarantine; next eligible ${next}."
      UE_DETAIL="The working branch already has ${UE_NEWEST}, the newest commit that has been on ${where} for ${h} hours.${waiting} Take nothing of them before then." ;;
    up-to-date)
      UE_SHORT="No new upstream commits: the working branch has upstream's tip ${UE_TIP:0:8}."
      UE_DETAIL="${where} is at ${UE_TIP}, which the working branch (${target_ref}) already contains." ;;
    rewritten)
      r="$UE_REWRITE"
      UE_SHORT="Upstream's history was rewritten inside the quarantine ($(cd_time "${UE_AT[$r]}"), ${UE_TYPE[$r]}): nothing is eligible before ${next}."
      UE_FINDING="The history of ${where} was rewritten $(cd_time "${UE_AT[$r]}") (${UE_TYPE[$r]}: ${UE_BEFORE[$r]} became ${UE_AFTER[$r]}), inside the ${h}-hour quarantine. Tell the owner, and take nothing from upstream."
      UE_DETAIL="An update of ${where} inside the last ${h} hours was not an ordinary push, so no commit can be shown to have stayed on the branch that long. Nothing is eligible before ${next}, ${h} hours after it." ;;
    not-eligible)
      if [ -n "$UE_ASKED_AT" ]; then
        UE_NEXT_AT="$UE_ASKED_AT"
        UE_SHORT="Upstream ${asked:0:8} is still in quarantine until $(cd_time "$UE_ASKED_AT")."
        UE_DETAIL="GitHub recorded the update that left ${where} at ${asked} less than ${h} hours ago. It comes out of quarantine $(cd_time "$UE_ASKED_AT"). Take nothing of it before then."
      else
        UE_SHORT="${asked:0:8} is not out of quarantine: it is not in the history of ${UE_NEWEST:0:8}, the newest commit that is."
        UE_DETAIL="${asked} is neither ${UE_NEWEST}, the newest commit that has been on ${where} for ${h} hours, nor in its history as this clone has it. It is newer than the quarantine allows, or it is not upstream's. Take nothing of it."
      fi ;;
  esac
}

if ! ue_evaluate; then
  UE_STATE="unknown" UE_COMMIT="" UE_FINDING=""
  UE_SHORT="The quarantine could not be evaluated; nothing is eligible."
  UE_DETAIL="The quarantine could not be evaluated: $(cd_problem_text)."
  ue_print
  exit 2
fi
ue_describe
ue_print
case "$UE_STATE" in eligible) exit 0 ;; *) exit 1 ;; esac
