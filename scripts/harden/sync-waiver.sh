#!/usr/bin/env bash
# The two steps of the "Waive sync cooldown" workflow (.github/workflows/sync-waiver.yml;
# docs/codeharden-sync-cooldown.md). A waiver lets one upstream commit ship before its 48
# hours are over. It is the repository owner's decision alone: the workflow's second job runs
# in the GitHub environment `sync-waiver`, which GitHub starts only after a required reviewer
# approved it. The record of a waiver is that approved, successful run itself, which
# scripts/harden/sync-cooldown.sh reads back from GitHub; this script writes nothing anywhere.
#
#   sync-waiver.sh check --upstream <sha> --commit <sha> [--pull-request <number>] [--upstream-ref <ref>] [--target-ref <ref>]
#       Before anyone is asked: the request is well formed, the run was started on the working
#       branch, the environment really is a gate (it exists, has required reviewers of whom
#       one may waive, admits only the working branch and lets no administrator skip the
#       review), the upstream commit is on upstream's branch, and the commit is the pull
#       request's head as it is now and brings exactly that upstream commit (without a pull
#       request: a commit of the working branch that does). Prints what approving would waive.
#   sync-waiver.sh confirm --upstream <sha> --commit <sha> [--pull-request <number>]
#       After the approval: GitHub recorded the approval of someone who may waive for this
#       run, and the pull request's head is still that commit. When either is not so the run
#       fails, and a failed run is no waiver.
#
# Runs inside a git repository whose `origin` is this repository on GitHub and that has the
# working branch as `refs/sync/target` (the workflow makes a bare one). Nothing of a pull
# request is checked out or run: its head commit is fetched as data, for ancestry.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/harden/sync-cooldown.sh
. "${script_dir}/sync-cooldown.sh"

mode="${1:-}"
case "$mode" in
  check | confirm) shift ;;
  *) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
upstream=""
number=""
commit=""
upstream_ref=""
target_ref="refs/sync/target"
while [ $# -gt 0 ]; do
  case "$1" in
    --upstream) upstream="${2:-}"; shift ;;
    --pull-request) number="${2:-}"; shift ;;
    --commit) commit="${2:-}"; shift ;;
    --upstream-ref) upstream_ref="${2:-}"; shift ;;
    --target-ref) target_ref="${2:-}"; shift ;;
    *) echo "sync-waiver: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

stop() {
  echo "::error::$1"
  exit 1
}
summary() {
  printf '%s\n' "$1"
  [ -z "${GITHUB_STEP_SUMMARY:-}" ] || printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
}

[[ "$upstream" =~ ^[0-9a-f]{40}$ ]] || stop "The upstream commit must be its full id: 40 characters, 0-9 and a-f."
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || stop "The commit must be its full id: 40 characters, 0-9 and a-f."
[ -z "$number" ] || [[ "$number" =~ ^[1-9][0-9]*$ ]] || stop "The pull request must be its number, or left empty."

FORK_CONFIG_WHO="sync-waiver"
# shellcheck source=scripts/harden/fork-config.sh
. "${script_dir}/fork-config.sh"
fork_config_resolve UPSTREAM_REPO UPSTREAM_BRANCH HARDEN_BRANCH
# The repository asked: this clone's origin when it is on GitHub.
SYNC_COOLDOWN_REPO="${FORK_REPO:-${SYNC_COOLDOWN_REPO:-}}"
cd_init
CD_BRANCH="$HARDEN_BRANCH"
what="upstream commit ${upstream}, brought by the commit ${commit}"
[ -z "$number" ] || what="upstream commit ${upstream}, brought by pull request #${number} at its head ${commit}"
may="the repository's owner (${CD_REPO%%/*})"
[ -z "${SYNC_WAIVER_APPROVERS:-}" ] || may="one of: ${SYNC_WAIVER_APPROVERS} (the repository variable SYNC_WAIVER_APPROVERS)"

# The gate is the environment's doing, not this script's: GitHub holds the job until a
# required reviewer approved. What is checked here is that the gate is there, because GitHub
# creates an environment that a workflow names and that does not exist, with no rules at all.
# Prints one line for each thing that is wrong.
gate_problems() {
  local rules reviewers branches bypass allowed logins
  if ! rules=$(cd_gh api "repos/${CD_REPO}/environments/${WAIVER_ENVIRONMENT}" --jq \
    '"\([.protection_rules[]? | (.reviewers // []) | length] | add // 0) \(.deployment_branch_policy | if . == null then "any" elif .custom_branch_policies == true then "selected" elif .protected_branches == true then "protected" else "any" end) \(.can_admins_bypass != false)"'); then
    echo "it does not exist, or can't be read"
    return 0
  fi
  read -r reviewers branches bypass <<< "$rules"
  [ "$reviewers" != "0" ] || echo "it has no required reviewers, so nothing would wait for an approval"
  # An approval counts only from someone who may waive: one of them must be able to give it.
  logins=$(cd_gh api "repos/${CD_REPO}/environments/${WAIVER_ENVIRONMENT}" --jq \
    '.protection_rules[]? | (.reviewers // [])[] | select(.type == "User") | .reviewer.login') || logins=""
  if [ "$reviewers" != "0" ] && ! cd_may_waive "$logins" > /dev/null; then
    echo "none of its reviewers ($(printf '%s' "$logins" | tr '\n' ' ')) may waive: that is ${may}"
  fi
  case "$branches" in
    selected)
      if ! allowed=$(cd_gh api "repos/${CD_REPO}/environments/${WAIVER_ENVIRONMENT}/deployment-branch-policies?per_page=100" --jq \
        '[.branch_policies[] | "\(.type // "branch") \(.name)"] | join(", ")'); then
        echo "its branch rules can't be read"
      elif [ "$allowed" != "branch ${HARDEN_BRANCH}" ]; then
        echo "it may be used by: ${allowed:-no branch at all}; only the branch ${HARDEN_BRANCH} should be allowed"
      fi ;;
    protected) echo "it lets every protected branch use it (and every branch, when none is protected)" ;;
    *) echo "it lets every branch use it, so a workflow file on any branch could ask for an approval" ;;
  esac
  [ "$bypass" != "true" ] || echo "it lets administrators start its jobs without a review (\"Allow administrators to bypass configured protection rules\" is on)"
}

# The pull request's head commit, as data.
fetch_head() {
  git cat-file -e "${PR_HEAD}^{commit}" 2> /dev/null || git fetch --quiet --no-tags origin "$PR_HEAD" 2> /dev/null || true
  git cat-file -e "${PR_HEAD}^{commit}" 2> /dev/null || stop "The head commit of pull request #${number} (${PR_HEAD}) couldn't be fetched."
}

if [ "$mode" = "check" ]; then
  if [ -n "${GITHUB_REF:-}" ] && [ "$GITHUB_REF" != "refs/heads/${HARDEN_BRANCH}" ]; then
    stop "A waiver must be started on ${HARDEN_BRANCH}; this run was started on ${GITHUB_REF}."
  fi
  problems=$(gate_problems)
  if [ -n "$problems" ]; then
    stop "The environment \"${WAIVER_ENVIRONMENT}\" is not a gate: $(printf '%s\n' "$problems" | awk 'NR > 1 { printf "; " } { printf "%s", $0 }'). Nothing is recorded. Under Settings > Environments > ${WAIVER_ENVIRONMENT}: required reviewers, \"Selected branches and tags\" with one rule (the branch ${HARDEN_BRANCH}), and \"Allow administrators to bypass configured protection rules\" off (${COOLDOWN_DOCS})."
  fi

  if [ -z "$upstream_ref" ]; then
    upstream_ref="refs/sync/upstream"
    git fetch --quiet --no-tags "https://github.com/${UPSTREAM_REPO}" "+refs/heads/${UPSTREAM_BRANCH}:${upstream_ref}" \
      || stop "Couldn't fetch ${UPSTREAM_BRANCH} from ${UPSTREAM_REPO}."
  fi
  if ! git cat-file -e "${upstream}^{commit}" 2> /dev/null || ! git merge-base --is-ancestor "$upstream" "$upstream_ref"; then
    stop "${upstream} is not a commit of ${UPSTREAM_REPO}'s ${UPSTREAM_BRANCH}. A waiver names the upstream commit a sync brings: the newest upstream commit its head contains."
  fi

  if [ -n "$number" ]; then
    cd_read_pull_request "$number" || stop "Pull request #${number} couldn't be read: $(cd_problem_text)."
    [ "$PR_BASE" = "$HARDEN_BRANCH" ] || stop "Pull request #${number} is into ${PR_BASE}, not into ${HARDEN_BRANCH}."
    if [ "$PR_STATE" != "open" ] && [ "$PR_MERGED_AT" = "-" ]; then
      stop "Pull request #${number} was closed without being merged."
    fi
    [ "$PR_HEAD" = "$commit" ] || stop "Pull request #${number}'s head is ${PR_HEAD}, not ${commit}. A waiver is for the head as it is now: check what changed, then enter the new one."
    fetch_head
    brings=$(git merge-base "$PR_HEAD" "$upstream_ref" 2> /dev/null) || brings=""
    if [ "$brings" != "$upstream" ]; then
      stop "Pull request #${number} brings upstream up to ${brings:-nothing}, not to ${upstream}. A waiver is for exactly the upstream commit a pull request brings."
    fi
    # What it is waived from, in the rule's own words.
    cd_evaluate "$upstream" || stop "The cooldown of pull request #${number} couldn't be evaluated: $(cd_problem_text)."
    if [ "$CD_STATE" = "satisfied" ]; then
      stop "Pull request #${number} has waited out its cooldown (approved $(cd_time "$CD_APPROVED_AT")). There is nothing to waive."
    fi
  else
    # Upstream commits that arrived without a pull request: the commit that brought them in.
    if ! git merge-base --is-ancestor "$commit" "$target_ref" 2> /dev/null; then
      stop "${commit} is not a commit of ${HARDEN_BRANCH}. Without a pull request, a waiver names the commit of ${HARDEN_BRANCH} that brought the upstream commit in; a release that is refused prints it."
    fi
    brings=$(git merge-base "$commit" "$upstream_ref" 2> /dev/null) || brings=""
    if [ "$brings" != "$upstream" ]; then
      stop "The commit ${commit} brings upstream up to ${brings:-nothing}, not to ${upstream}."
    fi
  fi

  summary "### Waive the ${COOLDOWN_HOURS}-hour sync cooldown"
  summary ""
  summary "Approving this run lets **${what}** ship before its ${COOLDOWN_HOURS} hours are over."
  summary ""
  if [ -n "$number" ]; then
    summary "- Pull request #${number} (\`${PR_HEAD_REF}\`). The waiver is for that head only: after a push to the branch it no longer applies."
    if [ "$CD_STATE" != "waived" ]; then
      cd_describe
      summary "- Without the waiver: ${CD_DETAIL}"
    else
      summary "- It is already waived (${CD_WAIVER_URL})."
    fi
  else
    summary "- No pull request: the waiver is for the upstream commits that the commit \`${commit:0:8}\` brought into \`${HARDEN_BRANCH}\`, and for nothing else."
  fi
  summary "- Only an approval by ${may} counts."
  summary "- Its other conditions stay: the sync workflow still merges only a pull request that is labelled \`${APPROVED_LABEL}\`, not on hold, limited to upstream code and green."
  summary "- The record is this run and its review history, which GitHub keeps for its retention period (90 days at most). A release that ships the commit writes the waiver into its changelog entry."
  exit 0
fi

# confirm: the environment's job, so a reviewer approved it. Unless GitHub says otherwise.
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || stop "This step runs in the workflow only."
approved=$(cd_gh api "repos/${CD_REPO}/actions/runs/${GITHUB_RUN_ID}/approvals" --jq \
  ".[] | select(.state == \"approved\" and any(.environments[]; .name == \"${WAIVER_ENVIRONMENT}\")) | .user.login") \
  || stop "This run's review history couldn't be read: $(cd_problem_text). Nothing is recorded."
[ -n "$approved" ] || stop "GitHub has no record of a reviewer approving this run for the environment \"${WAIVER_ENVIRONMENT}\", so it is not a waiver. Check the environment's required reviewers (${COOLDOWN_DOCS})."
by=$(cd_may_waive "$approved") || stop "This run was approved by $(printf '%s' "$approved" | tr '\n' ' '), and only ${may} may waive, so it is not a waiver."
if [ -n "$number" ]; then
  cd_read_pull_request "$number" || stop "Pull request #${number} couldn't be read: $(cd_problem_text). Nothing is recorded."
  if [ "$PR_HEAD" != "$commit" ]; then
    stop "Pull request #${number}'s head moved while this run waited (${commit} is now ${PR_HEAD}). Nothing is recorded: start the workflow again for the new head."
  fi
fi
summary "### Sync cooldown waived by the owner"
summary ""
summary "Approved by **${by}**: ${what} may ship before its ${COOLDOWN_HOURS} hours are over."
summary ""
summary "- The pull request's status \"${STATUS_CONTEXT}\" turns green within minutes, and \`scripts/harden/release.sh\` lets the release through and says that it was waived."
summary "- This run is the record. Don't delete it before the release is cut."
