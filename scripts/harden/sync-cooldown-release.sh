#!/usr/bin/env bash
# The cooldown, asked for a release: did every upstream change this release would ship wait
# out its cooldown before it was merged (scripts/harden/sync-cooldown.sh has the rule)?
#
#   sync-cooldown-release.sh --since <commit> --prev-base <sha> --new-base <sha> --upstream-ref <ref> --branch <name> [--remote <name>] [--notes <file>]
#
# `since` is the last release's commit, `prev-base` the upstream commit that release
# contained, `new-base` the one HEAD contains now. It looks at the branch's own line (first
# parents from HEAD) since that release, in two ways, because upstream code can arrive with
# its history or without it:
#
#   1. With its history. Every step of the line on which upstream commits arrived is
#      accounted for. A commit of this side that contains upstream commits its first parent
#      lacks is traced to the pull request it is the merge of, and the rule is asked about
#      that pull request at the moment it was merged. An upstream commit that sits on the
#      line itself arrived by a fast-forward or a direct push, with no pull request.
#   2. Without its history. A pull request that was squashed or rebased leaves no trace of
#      what it carried, so every pull request merged since the release is looked at: one
#      whose head is not part of the branch, and that is a `sync/...` branch or carries
#      upstream commits the branch lacked, is asked about in the same way. Its head commit is
#      fetched from the remote when it is not here.
#
#   exit 0  each had waited, or the owner waived it. Prints one line for each; a waived one
#           is also written to the notes file, for the release's changelog entry.
#   exit 1  at least one had not. Prints which, from when it would have been allowed and what
#           to enter in the waiver.
#   exit 2  it could not be decided: GitHub could not be asked, or a pull request's head
#           could not be had. That is not a yes: the caller refuses the release.
#
# What it can't see: upstream code copied in by hand (a cherry-pick, a patch) in a commit or
# pull request that has no upstream ancestry and is not a `sync/...` branch.
#
# release.sh calls it for every release. It changes nothing but that fetch.
set -euo pipefail

# shellcheck source=scripts/harden/sync-cooldown.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-cooldown.sh"

# Where new upstream commits arrived on the branch's own line, newest first: `landing <commit>`
# for a commit of this side that contains upstream commits its first parent lacks, and
# `direct <commit>` for an upstream commit on the line itself. Every upstream commit after $1
# arrived on exactly one of these steps, so none is left unaccounted for.
cr_arrivals() {
  local prev="$1" upstream_ref="$2" commit base parent_base
  while read -r commit; do
    if git merge-base --is-ancestor "$commit" "$upstream_ref" 2> /dev/null; then
      # From here down the line is upstream's own.
      git merge-base --is-ancestor "$commit" "$prev" 2> /dev/null || echo "direct ${commit}"
      break
    fi
    base=$(git merge-base "$commit" "$upstream_ref" 2> /dev/null) || break
    if git merge-base --is-ancestor "$base" "$prev" 2> /dev/null; then break; fi
    parent_base=$(git merge-base "${commit}^1" "$upstream_ref" 2> /dev/null) || parent_base=""
    [ "$parent_base" = "$base" ] || echo "landing ${commit}"
  done < <(git rev-list --first-parent HEAD)
}

# The pull requests merged into the branch whose merge is a commit of the line since the last
# release: writes "<commit of the line> <number> <head commit> <head branch>" lines to
# $CD_TMP/pulls. The newest merged pull requests are read in one list; a commit the list has
# no pull request for is asked about by itself.
cr_merged_pull_requests() {
  local page rows commit
  local row="\"\\(.number) \\(.head.sha) \\(.head.ref)\""
  local merged=".[] | select(.merged_at != null and .base.ref == \"${CD_BRANCH}\")"
  : > "$CD_TMP/pulls"
  [ -s "$CD_TMP/line" ] || return 0
  for page in 1 2 3; do
    rows=$(cd_gh api --method GET "repos/${CD_REPO}/pulls" -f state=closed -f "base=${CD_BRANCH}" -f sort=updated \
      -f direction=desc -f per_page=100 -f "page=${page}" --jq "${merged} | \"\\(.merge_commit_sha // \"-\") \" + ${row}") || return 2
    [ -n "$rows" ] || break
    # Only the ones that are a commit of the line.
    printf '%s\n' "$rows" | cr_keep in "$CD_TMP/line" >> "$CD_TMP/pulls"
    [ -n "$(cr_unmatched)" ] || return 0
  done
  for commit in $(cr_unmatched); do
    if rows=$(cd_gh api "repos/${CD_REPO}/commits/${commit}/pulls" --jq "${merged} | \"${commit} \" + ${row}"); then
      [ -z "$rows" ] || printf '%s\n' "$rows" >> "$CD_TMP/pulls"
    elif ! grep -q "HTTP 422" "$CD_TMP/gh-error" 2> /dev/null; then
      return 2
    fi
    # HTTP 422: a commit GitHub doesn't have, made here and not pushed. It has no pull request.
  done
}
cr_unmatched() {
  cr_keep out "$CD_TMP/pulls" < "$CD_TMP/line"
}
# The lines of its input whose first word is (`in`) or is not (`out`) a first word of file $2.
cr_keep() {
  awk -v want="$1" -v file="$2" '
    BEGIN { while ((getline row < file) > 0) { split(row, word, " "); known[word[1]] = 1 } }
    (($1 in known) ? "in" : "out") == want'
}

# Why a merged pull request had not waited when it was merged, and from when it would have.
cr_why() {
  local h="$COOLDOWN_HOURS" approved="" ready="" pushed="" after="after"
  [ -z "$CD_APPROVED_AT" ] || approved=$(cd_time "$CD_APPROVED_AT")
  [ -z "$CD_READY_AT" ] || ready=$(cd_time "$CD_READY_AT")
  [ -z "$CD_PUSH_AT" ] || pushed=$(cd_time "$CD_PUSH_AT")
  if [ "$CD_PUSH_AT" = "$CD_APPROVED_AT" ]; then after="in the same second as"; fi
  case "$CD_STATE" in
    not-approved)
      echo "it did not have the label ${APPROVED_LABEL} when it was merged, so there is no time from which it would have been allowed" ;;
    waiting)
      echo "it was merged $(cd_hours $((CD_AT - CD_APPROVED_AT))) after ${APPROVED_LABEL} was applied (${approved}); it would have been allowed from ${ready}" ;;
    held)
      if [ -n "$ready" ]; then
        echo "it had the label ${HOLD_LABEL} when it was merged; without the hold it would have been allowed from ${ready}"
      else
        echo "it had the label ${HOLD_LABEL} and not the label ${APPROVED_LABEL} when it was merged, so there is no time from which it would have been allowed"
      fi ;;
    head-moved)
      echo "its head branch was pushed ${pushed}, ${after} ${APPROVED_LABEL} was applied (${approved}), so the approval did not cover what was merged; it would have been allowed ${h} hours after the label was applied again" ;;
    unsettled)
      echo "GitHub's record of the pushes to its head branch does not end at the commit that was merged, so it can't be shown that nothing was pushed after the approval" ;;
    foreign)
      echo "its head branch was in another repository (${PR_HEAD_REPO}), whose pushes can't be read" ;;
    *) echo "the cooldown rule did not hold (${CD_STATE})" ;;
  esac
}

# The verdict on one arrival, into `passed`, `waivers` and `refused`. $1 says what arrived and
# how; $2 is the upstream commit, $3 the pull request (empty: none) and $4 the commit a waiver
# is for. With a pull request, the rule has been asked (cd_evaluate).
cr_record() {
  local what="$1" upstream="$2" number="$3" commit="$4"
  if [ -z "$number" ]; then
    CD_STATE="no-pull-request"
    if cd_find_waiver "$upstream" "" "$commit"; then CD_STATE="waived"; fi
  fi
  case "$CD_STATE" in
    satisfied)
      passed="${passed}Sync cooldown: ${what}, $(cd_hours $((CD_AT - CD_APPROVED_AT))) after ${APPROVED_LABEL} was applied ($(cd_time "$CD_APPROVED_AT")).
" ;;
    waived)
      passed="${passed}Sync cooldown waived by the owner: ${what}; ${CD_WAIVER_BY} approved the waiver run that started $(cd_time "$CD_WAIVER_AT") (${CD_WAIVER_URL}).
"
      waivers="${waivers}Sync cooldown waived by the owner for upstream ${upstream:0:8} (approved by ${CD_WAIVER_BY}, $(cd_time "$CD_WAIVER_AT")).
" ;;
    no-pull-request)
      refused="${refused}  - ${what}: nothing was approved, so there is no time from which it would have been allowed.
    To waive: upstream ${upstream}, no pull request, commit ${commit}.
" ;;
    *)
      refused="${refused}  - ${what}: $(cr_why).
    To waive: upstream ${upstream}, pull request ${number}, commit ${commit}.
" ;;
  esac
}

cr_main() {
  local since="" prev="" new="" upstream_ref="" remote="" notes=""
  local kind commit upstream number head ref what judged=" " newest
  passed="" waivers="" refused=""
  CD_BRANCH=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --since) since="${2:-}"; shift ;;
      --prev-base) prev="${2:-}"; shift ;;
      --new-base) new="${2:-}"; shift ;;
      --upstream-ref) upstream_ref="${2:-}"; shift ;;
      --branch) CD_BRANCH="${2:-}"; shift ;;
      --remote) remote="${2:-}"; shift ;;
      --notes) notes="${2:-}"; shift ;;
      *) echo "sync-cooldown-release: unknown option $1" >&2; exit 2 ;;
    esac
    shift
  done
  if ! [[ "$since" =~ ^[0-9a-f]{40}$ && "$prev" =~ ^[0-9a-f]{40}$ && "$new" =~ ^[0-9a-f]{40}$ && "$CD_BRANCH" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || [ -z "$upstream_ref" ]; then
    echo "sync-cooldown-release: needs --since, --prev-base, --new-base (full commit ids), --upstream-ref and --branch" >&2
    exit 2
  fi
  cd_init
  [ -z "$notes" ] || : > "$notes"

  git rev-list --first-parent "${since}..HEAD" > "$CD_TMP/line"
  if ! cr_merged_pull_requests; then
    echo "GitHub could not be asked which pull requests were merged since the last release: $(cd_problem_text)."
    exit 2
  fi

  # 1. Upstream commits that arrived with their history, oldest first.
  cr_arrivals "$prev" "$upstream_ref" > "$CD_TMP/arrivals"
  newest=$(head -n 1 "$CD_TMP/arrivals" | cut -d ' ' -f 2)
  if [ "$prev" != "$new" ] && { [ -z "$newest" ] || [ "$(git merge-base "$newest" "$upstream_ref")" != "$new" ]; }; then
    echo "The upstream commits in this release (${prev:0:8}..${new:0:8}) can't all be traced to a step on ${CD_BRANCH}'s own line."
    exit 2
  fi
  while read -r kind commit; do
    [ -n "$commit" ] || continue
    upstream=$(git merge-base "$commit" "$upstream_ref")
    number=""
    if [ "$kind" = "landing" ]; then
      number=$(awk -v c="$commit" '$1 == c || $3 == c { print $2; exit }' "$CD_TMP/pulls")
    fi
    if [ -z "$number" ]; then
      what="upstream ${upstream:0:8} came in through the commit ${commit:0:8} (\"$(git log -1 --format=%s "$commit")\"), which is not the merge of a pull request into ${CD_BRANCH}"
      if [ "$kind" = "direct" ]; then
        what="upstream ${upstream:0:8} is on ${CD_BRANCH}'s own line: it arrived by a fast-forward or a direct push, not through a pull request"
      fi
      cr_record "$what" "$upstream" "" "$commit"
      continue
    fi
    if ! cd_read_pull_request "$number" || ! cd_evaluate "$upstream"; then
      echo "GitHub could not be asked about pull request #${number}, which brought upstream ${upstream:0:8} in: $(cd_problem_text)."
      exit 2
    fi
    judged="${judged}${number} "
    cr_record "upstream ${upstream:0:8} came in through pull request #${PR_NUMBER} (${PR_HEAD_REF}), merged $(cd_time "$CD_AT")" \
      "$upstream" "$number" "$PR_HEAD"
  done < <(awk '{ line[NR] = $0 } END { for (i = NR; i > 0; i--) print line[i] }' "$CD_TMP/arrivals")

  # 2. Pull requests whose head is not part of the branch: squashed or rebased, so what they
  #    carried left no history. Oldest first.
  while read -r commit number head ref; do
    [ -n "$number" ] || continue
    case "$judged" in *" ${number} "*) continue ;; esac
    judged="${judged}${number} "
    if ! git cat-file -e "${head}^{commit}" 2> /dev/null && [ -n "$remote" ]; then
      git fetch --quiet --no-tags "$remote" "refs/pull/${number}/head" 2> /dev/null || true
    fi
    if ! git cat-file -e "${head}^{commit}" 2> /dev/null; then
      echo "The head commit of pull request #${number} (${head}), merged since the last release, is not here and could not be fetched, so it can't be told whether it carried upstream commits."
      exit 2
    fi
    if git merge-base --is-ancestor "$head" HEAD 2> /dev/null; then continue; fi
    upstream=$(git merge-base "$head" "$upstream_ref" 2> /dev/null) || upstream=""
    case "$ref" in
      "${SYNC_HEAD_PREFIX}"*) ;;
      *)
        if [ -z "$upstream" ] || git merge-base --is-ancestor "$upstream" "${commit}^1" 2> /dev/null; then continue; fi ;;
    esac
    if ! cd_read_pull_request "$number" || ! cd_evaluate "$upstream"; then
      echo "GitHub could not be asked about pull request #${number}, which was merged without its history: $(cd_problem_text)."
      exit 2
    fi
    cr_record "pull request #${PR_NUMBER} (${PR_HEAD_REF}), merged $(cd_time "$CD_AT") without its history (squashed or rebased), carries upstream up to ${upstream:0:8}" \
      "$upstream" "$number" "$PR_HEAD"
  done < <(awk '{ line[NR] = $0 } END { for (i = NR; i > 0; i--) print line[i] }' "$CD_TMP/pulls")

  if [ -n "$refused" ]; then
    printf 'This release would ship upstream changes that had not waited out the %s-hour cooldown when they were merged:\n%s' "$COOLDOWN_HOURS" "$refused"
    printf 'Only the repository owner can let it through: Actions > "%s" > Run workflow on %s, with the three values above. The run waits for the owner'"'"'s approval in the environment %s; when it has finished, run the release again. Nobody else waives it, and there is no other way around it (%s).\n' \
      "$WAIVER_WORKFLOW_NAME" "$CD_BRANCH" "$WAIVER_ENVIRONMENT" "$COOLDOWN_DOCS"
    exit 1
  fi
  if [ -z "$passed" ]; then
    passed="Sync cooldown: no upstream commits arrived since the last release ($(wc -l < "$CD_TMP/pulls" | tr -d ' ') merged pull requests looked at).
"
  fi
  printf '%s' "$passed"
  [ -z "$notes" ] || printf '%s' "$waivers" > "$notes"
}

cr_main "$@"
