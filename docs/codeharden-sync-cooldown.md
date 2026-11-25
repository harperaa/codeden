# The 48-hour cooldown of upstream changes

CodeHarden takes upstream's changes every day, and none of them reaches users until it was approved and then waited 48 hours. The wait is the time in which a bad upstream change can still be caught, by the second reviewer, by the owner, or by upstream itself. This page says where the wait is enforced, what you see while it runs, and the one way around it.

There are two waits, one after the other. Before a sync exists, an upstream commit is in **quarantine** for 48 hours: nothing of it is fetched, installed, built or tested. After a sync was reviewed and approved, it waits out its **cooldown** of 48 hours before it is merged. The quarantine comes first on this page; everything from [The rule](#the-rule) on is the cooldown.

## The quarantine: 48 hours before a sync

A compromised upstream commit, or a compromised dependency it pulls in, does its damage when it is installed and run: on the machine that reviews it and in CI. So no upstream commit is fetched, installed, built or tested until it has been publicly on upstream's branch for 48 hours. Most bad pushes are noticed and taken back well inside that time, by upstream or by the people who use it.

**One helper decides it**, `scripts/harden/upstream-eligible.sh`, and it decides it without taking any upstream code. It asks GitHub two things about upstream's branch, both metadata: where the branch is now, and when each update of it was recorded. It fetches no git objects, downloads no file and runs nothing.

```sh
git fetch origin harden                      # the working branch, and only that
scripts/harden/upstream-eligible.sh latest   # the newest upstream commit out of quarantine
```

```text
state: eligible
short: Upstream 1a2b3c4d is out of quarantine: on main since 2026-01-03 09:12 UTC. 2 newer updates are still in quarantine; the first comes out 2026-01-06 15:40 UTC.
commit: 1a2b3c4d5e6f...
...
```

| `state` | Exit | Meaning |
|---|---|---|
| `eligible` | 0 | `commit` is the newest upstream commit that has been on the branch for 48 hours and that the working branch doesn't have. A sync takes upstream **up to that commit**, fetched by its id. It is often not upstream's tip: the newer commits are for a later day. |
| `none` | 1 | Everything that is out of quarantine is already in the working branch. `next` says when the next commit comes out. |
| `up-to-date` | 1 | The working branch has upstream's tip. |
| `rewritten` | 1 | Upstream's history was rewritten inside the last 48 hours (see below). Nothing is eligible; `finding` says what happened. |
| `unknown` | 2 | GitHub could not say. Never a yes. |

`scripts/harden/upstream-eligible.sh check <commit>` answers for one commit (`eligible`, `not-eligible`, `rewritten`, `unknown`): it is out of quarantine when it is the newest such commit or in its history.

**The two waits, in order.**

| | When | Decided by |
|---|---|---|
| A commit arrives on upstream's branch | T | |
| It is out of quarantine | T + 48 hours | `scripts/harden/upstream-eligible.sh` |
| The first review builds the sync pull request, CI runs on it | the next 09:00 (America/New_York) | |
| The second review approves it (`sync-approved`) | the same day, 11:00 or 15:00 | |
| Its cooldown is over | the approval + 48 hours | `scripts/harden/sync-cooldown.sh` |
| It is merged and released | the next 13:00 UTC | the merge job, `scripts/harden/release.sh` |

So an upstream change reaches a release at least 96 hours after it was pushed, and in practice after about five days: pushed Monday 10:00 UTC, out of quarantine Wednesday 10:00 UTC, reviewed and approved that Wednesday (about 16:00 UTC), cooldown over Friday 16:00 UTC, merged and released Saturday 13:00 UTC. Without the quarantine the same commit was released on Thursday.

**What counts as a commit's age, and why not its date.** A commit carries an author date and a committer date, and whoever makes the commit writes both: a commit dated last month can be pushed today. So the helper never reads them. It asks GitHub's record of the branch (the repository's activity, `GET /repos/{owner}/{repo}/activity` with `ref`), where GitHub itself writes the time of every update of the branch together with the commit the branch was at before and after it. The newest update that is 48 hours old or older left the branch at one commit; that commit, and everything in its history, has been public on the branch at least that long. That is the commit the helper names. The commits of one push come out together, when the push is 48 hours old.

**When GitHub can't say, the answer is no.** The helper answers `unknown`, and nothing is fetched, when `gh` is missing or not signed in, GitHub does not answer or is rate limited, an answer has a shape the helper does not know, the record has no update that is 48 hours old, the record's newest update does not end at the branch's tip (a push that is not in the record yet), or two updates in it don't join up. The next run asks again.

**A rewritten history is a finding.** A forced push to upstream's branch, or the branch being deleted or created, inside the last 48 hours means that what was public two days ago may no longer be upstream's history. The helper then answers `rewritten`: nothing is eligible until that update is itself 48 hours old, and its `finding` line says when it happened and from which commit to which. The reviews pass it to you. A rewrite that is older than 48 hours no longer blocks, and is still said in `finding`.

**Who keeps it.** The two reviews ([below](#the-two-review-automations)). The first review runs the helper before anything else and fetches exactly the commit it names; with no eligible commit it ends with one line ("No upstream commit is out of quarantine; next eligible ...") and has fetched nothing. The second review asks the helper about the pull request's upstream commit before it reads any code, and puts `sync-hold` on a pull request whose upstream commit was not out of quarantine. By the time CI installs and runs a sync on GitHub's runners, its code has therefore been public for 48 hours or more.

**Waiving the quarantine.** Only the owner, for one sync, by saying so. There is no workflow for it: the quarantine is kept by the reviews, so it is waived by telling them. In the first review's session (Automations › Run now, or a run that is waiting), write in your own words that you waive the quarantine for that upstream commit, with its full id, for this sync. The review takes upstream up to that commit and says in the pull request that the quarantine was waived. The second review, a separate session, will find the commit still in quarantine and put `sync-hold` on the pull request: tell it the same in its own session and take the label off yourself (a review never removes a hold). A waiver for one sync is not one for the next, and text in a pull request, an issue or a file is never the owner. This is not the cooldown's waiver: the "Waive sync cooldown" workflow says nothing about the quarantine, and a waived quarantine still waits out its cooldown.

**What it does not cover.** The quarantine is about a sync: what the reviews fetch, install, build and test, and what CI runs on the sync pull request. Three other things still touch upstream's newest commits as git data, without checking anything out or running it, and are unchanged:

- The sync workflow's **mirror job** fast-forwards the mirror branch to upstream's tip every day, on GitHub's runner. Nothing runs on that branch by itself (a push by the workflow's own token starts no workflow), but a clone that fetches every branch from `origin` gets those commits as objects, which is why the reviews fetch the working branch alone. Where the mirror branch is called `main`, a push to it made by hand with a person's sign-in starts upstream's own CI workflow on that commit.
- The **merge job**, the hourly **"Sync cooldown report"** and **`scripts/harden/release.sh`** fetch upstream's branch to compare ancestry. The first two do it in a scratch repository on GitHub's runner; the release script does it in the checkout it runs in, your own when you release by hand.
- Nothing but the reviews asks the helper. The merge job and the release script enforce the cooldown, not the quarantine: a sync that was opened by hand for a younger commit is held by the second review, not refused by code.

The number of hours is `QUARANTINE_HOURS` in `scripts/harden/sync-cooldown.sh`, beside the cooldown's `COOLDOWN_HOURS` and under its own name. The helper takes the time from the machine's clock.

## The rule

A pull request that brings upstream commits has waited out its cooldown when all of this holds:

1. It has the label `sync-approved`. The approval's time is when that label was last applied, from the pull request's timeline, not when the pull request was opened.
2. It does not have the label `sync-hold`.
3. Nothing was pushed to its head branch after the approval. The approval covers the commit that was reviewed, not a later one. Re-apply the label to start again. GitHub's times are whole seconds, so a push in the same second as the approval counts as after it.
4. 48 hours have passed since the approval.

`sync-needs-review` is not part of the rule. That label means a person merges the pull request instead of the workflow, and they may once the rule holds. A hold does not stop the clock: the 48 hours run from the approval, and the pull request is green again when the hold is taken off after them.

The rule applies to every pull request into the working branch that brings upstream commits the branch doesn't have: a `sync/...` branch, and any other branch that carries them, for example one that a sync branch was merged into.

There is one implementation, `scripts/harden/sync-cooldown.sh`, and everything below asks it. Nothing else has its own copy of the 48, of the labels or of the logic.

## Where it is enforced

| Where | What happens | How strong |
|---|---|---|
| On the pull request | The status **Sync cooldown** shows the rule's answer. | Information. A status can be written by anyone who can push, so nothing relies on it. |
| The automatic merge | The "Upstream sync merge" workflow's merge job asks the rule and merges only on "satisfied" or "waived". Its other conditions are unchanged. | Enforced: the job reads GitHub's records itself. |
| The release | `scripts/harden/release.sh` asks the rule about everything that was merged since the last release, at the moment it was merged, and refuses to cut the release otherwise. The sync workflow's release job runs the same script. | Enforced for everyone who releases with the script, which is how a release is made. |
| npm and the installers | Nothing of their own. `scripts/harden/publish.sh` publishes only the checked-out tag `v<VERSION>`, and the "Desktop installers" workflow builds only an existing release tag on the default branch whose `VERSION` names it. That holds for tags `release.sh` made; neither can tell one that was made by hand. | As strong as the release. |
| A merge by hand | Not blocked. See [Merges by hand](#merges-by-hand). | By instruction, and caught at the release. |

So what is guaranteed is this: **the release script refuses a release in which an upstream change was merged before its 48 hours were over, unless the owner waived it.** A sync that touches a protected path or a workflow file has to be merged by hand, and a merge by hand has no timer. That is the case the release check exists for.

## What a pull request shows

The "Sync cooldown report" workflow writes the status **Sync cooldown** on the head commit of a pull request the rule applies to. A pull request that brings no upstream commits gets no status.

| Status | Text | Meaning |
|---|---|---|
| pending | Cooling down until 2026-01-07 14:55 UTC (approved 2026-01-05 14:55 UTC). Expected. Not a CI check. | The clock is running. |
| pending | On hold (label sync-hold). The 48 hours since the approval end 2026-01-07 14:55 UTC. Not a CI check. | Not to be merged while the label is on. |
| pending | Not approved yet: the 48 hours start when sync-approved is applied. Not a CI check. | The approval was taken off again, or this is not a sync branch (see below). |
| failure | Pushed 2026-01-06 09:00 UTC, after the approval (2026-01-05 14:55 UTC). Re-apply sync-approved. Not a CI check. | The approval no longer covers the head. |
| success | Cooldown over: approved 2026-01-05 14:55 UTC, 48 hours passed, nothing pushed since. | The cooldown is over. |
| success | Cooldown waived by the owner (approved by `<login>`, 2026-01-06 10:12 UTC). | See [Waiving the cooldown](#waiving-the-cooldown). Its "Details" link opens the approved run. |

All times are UTC.

**The status is a clock, not a CI check.** It can't be green before 48 hours after the approval, so nobody waits for it, counts it as a failed check, or tries to turn it green. For that reason a `sync/...` pull request gets its first status only when its clock is running: once it is approved, over, or waived. Before the approval it has none, and neither has a new head after a push, until it is approved again. The review that approves a sync looks at the checks on its head, and a status that can't be green yet must not be among them. A head that already has the status keeps being told the truth (the hold, the push, the label taken off). Any other branch that carries upstream commits gets the status at once, "Not approved yet", because nobody reviews that one as a sync.

The workflow runs every hour, when a label is added or removed, and when a waiver run has finished, so a pull request turns green by itself within the hour after its 48 hours are over. You can run it at once from Actions › Sync cooldown report › Run workflow. On a label event its job never fails; the hourly run fails only when the workflow itself is broken, and warns about a pull request it can't evaluate.

The sync workflow merges at 13:00 UTC. It asks the rule itself and writes the same status before it reads the pull request's mergeability, so it does not depend on the hourly run.

## What a release refuses

Before every release `scripts/harden/release.sh` asks GitHub about what was merged since the last one. It needs `gh`, signed in, every time.

**Where the last release was** is not read from the working tree. It is the newest release tag the remote has whose commit is on the branch's own line, and the upstream base is the one that release's commit wrote to `state/upstream-base`. The script refuses when `VERSION` or `state/upstream-base` have been changed since, and when a release that was made locally has not been pushed. Upstream's branch is fetched from the configured upstream, and a ref that is handed to the script must be exactly where that branch is.

**What it looks at.** Upstream code can arrive with its history or without it, so it looks both ways:

- *With its history.* It walks the branch's own line back to the last release and accounts for every step on which upstream commits arrived. A merge is traced to the pull request it is the merge of, and the rule is asked about that pull request at the moment it was merged. An upstream commit on the line itself arrived by a fast-forward or a direct push, with no pull request.
- *Without its history.* A pull request that was squashed or rebased leaves no trace of what it carried. So every pull request merged since the last release is looked at, and one whose head is not part of the branch is asked about when it was a `sync/...` branch or carried upstream commits the branch lacked.

It refuses when a pull request had not waited, when upstream commits came in without a pull request, and when it can't be decided: no `gh`, not signed in, an outage, a pull request's head that can't be fetched. `--dry-run` shows what the release would be, then the same verdict, with the same exit status.

```text
release: refused. This release would ship upstream changes that had not waited out the 48-hour cooldown when they were merged:
  - upstream 1a2b3c4d came in through pull request #41 (sync/2026-01-05), merged 2026-01-05 17:15 UTC: it was merged 2 hours after sync-approved was applied (2026-01-05 14:55 UTC); it would have been allowed from 2026-01-07 14:55 UTC.
    To waive: upstream 1a2b3c4d5e6f..., pull request 41, commit 9f8e7d6c5b4a....
Only the repository owner can let it through: Actions > "Waive sync cooldown" > Run workflow on harden, with the three values above. ...
release: nothing was changed
```

Waiting does not make it releasable. What counts is the moment of the merge: a sync that was merged early stays refused until the owner waives it. When a release goes through, it prints one line for each sync, and for a waived one it says so and writes the waiver into the release's changelog entry.

**What it can't see:** upstream code that was copied in by hand, as a cherry-pick or a patch, in a commit or a pull request that has no upstream ancestry and is not a `sync/...` branch.

## Waiving the cooldown

Only the repository owner waives, and only one upstream commit at one head.

1. Take the three values from the refused release: the upstream commit, the pull request's number and the commit (the pull request's head). For an open pull request, the upstream commit is in the "Sync cooldown report" run's summary, and the head is on the pull request's page; all three are full ids.
2. Actions › **Waive sync cooldown** › Run workflow, on the default branch. Enter them. Leave the pull request empty only for upstream commits that reached the branch without one; the commit is then the commit of the branch that brought them in.
3. The job "Check the request" runs first and says, in the run's summary, exactly what approving would waive. It refuses when the request doesn't fit: an upstream commit that is not upstream's, a commit that is not the pull request's head as it is now or that brings another upstream commit, a pull request that has already waited.
4. The job "Record the waiver" waits. Press **Review deployments**, tick `sync-waiver`, approve.
5. Within minutes the pull request's status reads "Cooldown waived by the owner". The sync workflow may merge it on its next run if its other conditions hold (labelled `sync-approved`, not on hold, upstream code only, checks green), and `release.sh` lets the release through.

**What a waiver covers, and for how long.** Exactly the upstream commit, the pull request and the commit its run names. After a push to the pull request's branch the head is another commit, and that one is not waived. The same upstream commit arriving another way, through another pull request or another merge, is not waived either. It counts for as long as GitHub keeps the run: the repository's retention period, 90 days at most. A waiver is needed from the approval until the release that ships the commit, usually the same day; a waiver whose run is gone is asked for again.

**Who may waive.** The repository's owner. An approval by any other reviewer of the environment does not count. A repository that an organization owns has no such person, so it names the logins in the repository variable `SYNC_WAIVER_APPROVERS` (space separated); with the variable set, that list is the whole of it.

**Where the record is.** The workflow writes nothing: no tag, no file, no variable. Any of those could also be written by whoever can push to the repository. The waiver is the run itself: a successful run of `sync-waiver.yml` on the working branch whose review history shows the approval, for the environment `sync-waiver`, of someone who may waive. That is GitHub's own record. It can be read without a secret (`gh api repos/<owner>/<repo>/actions/runs/<run id>/approvals`), it names who approved, the run's times say when, and it comes into being only by approving. The run's title names the three values. The release that ships the change writes the waiver into its entry in `CODEHARDEN-CHANGELOG.md`, where it stays after the run is gone.

## The environment

The approval is GitHub's doing: a job that names an environment with required reviewers does not start before one of them approved. The workflow checks that the gate is really there, and refuses to go on when the environment is missing (GitHub would create it on first use, with no protection), has no required reviewers or none who may waive, admits anything but the working branch, or lets administrators skip the review.

Settings › Environments › New environment, named `sync-waiver`:

- **Required reviewers:** the owner. "Prevent self-review" off when the owner is the only reviewer, or nobody could approve a run the owner started.
- **Allow administrators to bypass configured protection rules:** off.
- **Deployment branches and tags:** "Selected branches and tags", with one rule, the working branch (`harden`).
- No secrets. The environment exists for the approval alone.

Required reviewers are available for public repositories on every plan, and for private ones on some. A repository without them has no waiver: the cooldown can't be skipped there.

## What is enforced, and what is an instruction

Enforced by code that reads GitHub's own records:

- The automatic merge waits for the rule.
- The release script refuses upstream commits that were merged early, came in without a pull request, or were squashed or rebased in early, and it refuses when it can't decide.
- A waiver counts only when someone who may waive approved its run, and only for the commit it names.

Not enforced, and said plainly:

- **A merge by hand is possible at any time.** The status is red or pending, and the release is refused afterwards, but GitHub does not stop the merge.
- **The release script runs on the owner's machine.** Someone who writes the release commit and tag by hand and pushes them, changes the script, or sets the variables that say what upstream is, what time it is or who may waive (`UPSTREAM_URL`, `SYNC_COOLDOWN_NOW`, `SYNC_COOLDOWN_REPO`, `SYNC_WAIVER_APPROVERS`), goes around it. So does anyone who changes the scripts on the working branch; `scripts/harden/`, these workflows and the three files a release writes are protected paths for syncs, and a change to them is a pull request like any other.
- **Upstream code copied in by hand** leaves nothing the script can see.
- **An approval is as strong as the owner's sign-in.** GitHub's API lets a reviewer's token approve a waiting job, and agent sessions on the owner's machine act with the owner's sign-in. The waiver is a deliberate, separate step and a record of who took it, not a cryptographic separation.
- **The quarantine is kept by the reviews.** The helper's answer is computed from GitHub's own record, but only the two reviews ask it, because they are what fetches and runs upstream's code. The merge job and the release script do not: they enforce the cooldown. The helper trusts the machine's clock and the fork's configuration, like the release script does.

The instructions that cover those are in [AGENTS.md](../AGENTS.md): an agent never merges a pull request whose cooldown status is not green, never squashes or rebases a sync, never approves a waiver, runs the release script as it is, reports a refused release instead of working around it, and never fetches, installs, builds or tests an upstream commit the quarantine helper has not named.

## Merges by hand

A repository ruleset can require a status check on a branch, so the obvious question is whether "Sync cooldown" can be required for merges into the working branch. It can't be done safely here, and it is not set up:

- **The rule is not limited to pull requests.** A ruleset's required status check applies to every update of the branch: "When enabled, commits must first be pushed to another ref where the checks pass" ([REST API endpoints for rules](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)), and a direct push fails with "Required status check ... is failing" ([Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)).
- **Releases are direct pushes.** `release.sh --push` pushes a new commit and its tag straight to the working branch, from the owner's machine and from the sync workflow's release job. A new commit has no status, so both would be refused unless they are on the ruleset's bypass list.
- **The workflow's token has no documented bypass.** The bypass list takes repository roles, teams, deploy keys, GitHub Apps and users ([Creating rulesets for a repository](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository#granting-bypass-permissions-for-your-branch-or-tag-ruleset)). Nothing in GitHub's documentation says that the workflow token can be given one. Without it the release after every automatic merge would fail.
- **The owner's bypass is everyone's.** The owner's own push needs the bypass in the "always" mode, and agent sessions use the same sign-in, so `gh pr merge --admin` would go around the check for them too. Each bypass is listed under Insights › Rules, but it is an instruction again, not a block.
- **Every pull request would need the status.** A required check that is never reported leaves a pull request waiting for it forever. Here only pull requests that bring upstream commits get one, and a sync only after its approval, on purpose.

A mistake in such a rule would stop the daily sync and every release with nobody at the keyboard. If GitHub documents a bypass for the workflow token, the steps are: report the status on every pull request, add the ruleset (`POST /repos/{owner}/{repo}/rulesets`, the rule `required_status_checks` with the context `Sync cooldown`), and remove it again with `DELETE /repos/{owner}/{repo}/rulesets/{id}` if a release push is refused.

One setting does help and is the owner's to choose: with "Allow squash merging" and "Allow rebase merging" off (Settings › General › Pull Requests), a sync can only be merged with its history, which is the form the release check follows most directly. The check asks about squashed and rebased pull requests too, so this is belt and braces.

## The two review automations

The daily review of a sync is two automations that ship with the app (the npm package and the desktop app carry the same two files, `templates/harden-sync/` in the package, `apps/server/templates/harden-sync/` in the repository):

| Automation | Schedule | What it does |
|---|---|---|
| **Daily upstream sync: first review** | Every day 09:00 | Asks `scripts/harden/upstream-eligible.sh` which upstream commit is out of [quarantine](#the-quarantine-48-hours-before-a-sync), and ends there when none is. Otherwise it fetches exactly that commit, builds the `sync/YYYY-MM-DD` branch (the upstream commit itself, or one merge commit that resolves the conflicts), reads every change, runs the fast checks and the fork's own tests, opens the pull request into the working branch, waits for CI and sets `sync-first-pass`, `sync-needs-review` or `sync-hold`. It never sets `sync-approved` |
| **Daily upstream sync: second review** | Every day 11:00 and 15:00 | A separate session asks the helper about the pull request's upstream commit before it reads any code (`sync-hold` when it was not out of quarantine), then reads the same changes on its own first, checks the head's shape, the conflict resolutions and CI's result on the exact head commit, and only then compares with the first review. Only it sets `sync-approved`, which starts the cooldown's 48 hours, and it is the one that reports to you. It changes no code |

**Which projects get them.** Only a project whose folder is a checkout of a hardened fork: this repository or a fork of it. The app looks for the workspace's root `package.json` and two plain files, `scripts/harden/fork-config.sh` and `.github/workflows/upstream-sync-merge.yml`. It only looks: nothing in the project is run, and nothing from it goes into the automations, whose text is fixed in the app. No other project gets them, and they are not in the Templates gallery or the starter set.

**They arrive switched off.** Both run at the **Auto** permission level, push a `sync/...` branch and label pull requests, so you read them and switch each one on yourself in the project's Automations. **Enable starter set** does not switch them on. A project gets them when it is added, and a project from before the update gets them when the app next starts. They are ordinary automations of the project from then on: edit, duplicate or delete them. A deleted one doesn't come back by itself; to get it back, **Import** its file from the folder above.

**If you made them by hand before.** The app adds a shipped review only when no automation of the project (or for all projects) has its work key: `automation:upstream-sync-review` for the first, `automation:upstream-sync-second-review` for the second. An instance that already has hand-made ones with those work keys therefore keeps exactly what it has after updating, and no review runs twice. To move to the shipped text, delete your hand-made automation: the shipped one appears in its place at once, switched off, and you switch it on. (Renaming yours or changing its work key while it stays on would give you two that both run; delete it instead.)

**When the shipped text changes.** A project's copy is an ordinary automation from the moment it was added, so an update of the app does not rewrite it: it keeps the text it was created with. That matters when a rule was added, as the quarantine was. A review made before it (by hand, or from an earlier version) fetches upstream's newest commit the same morning, as before. To get the current text, open the automation and replace its prompt with the body of its file in the folder above, or delete it and **Import** that file; either way check that it names `scripts/harden/upstream-eligible.sh` in its first rule and its first step.

**What they depend on.**

- **The labels** `sync-approved`, `sync-needs-review` and `sync-hold` (`scripts/harden/setup-fork.sh` creates them). The first review creates `sync-first-pass` itself when it is missing; the merge job ignores that label.
- **The repository variables** `UPSTREAM_REPO`, `UPSTREAM_BRANCH` and, when set, `HARDEN_BRANCH` and `MIRROR_BRANCH`. The reviews take every name from the repository (`scripts/harden/fork-config.sh` or the variables), so the same text works in a fork.
- **`gh` signed in** on the machine, with the right to push branches and label pull requests in the fork, and `node` and `pnpm` installed.
- **The quarantine helper on the working branch**, `scripts/harden/upstream-eligible.sh`. It reads upstream's branch and its activity with `gh`, so the sign-in must be able to read upstream's repository. Without the helper, or without an answer from it, a review fetches nothing and tells you.
- **One inbox approval per run.** Each review writes its full findings, security findings included, to a private hand-off file outside its worktree, `harden-sync-review/<branch>.first.md` and `.second.md` in the repository's git folder. That file is never committed or pushed. Writing outside the worktree asks you once per run; the review waits for the answer.
- **Both in the same app instance.** The second review reads the first's hand-off file from that folder and the first's pull request from GitHub, so both automations must run in the same instance, on the same machine, for the same project. Run from another instance or machine, the second review would not find that file, and the first review's security findings and its questions for you are nowhere else.
- **The schedule is in America/New_York**, the timezone releases are stamped in. A fork in another timezone changes the two schedules in Automations.
- **No provider or model is pinned**: each review runs on the project's default agent, so the definitions need no agent you may not have. You can pick one for either review in its editor.

Security findings never go public: not in the pull request, a comment, a label or a branch name. They reach you in the second review's report and the inbox only.

## In a fork

A fork of CodeHarden gets all of it with the sync: the rule, the status, the release check and the waiver workflow. They read the fork's own names from its repository variables. To be able to waive, create the environment `sync-waiver` as above; `scripts/harden/setup-fork.sh` does not create environments. In a repository an organization owns, also set `SYNC_WAIVER_APPROVERS`. The number of hours is `COOLDOWN_HOURS` in `scripts/harden/sync-cooldown.sh`, and the quarantine's is `QUARANTINE_HOURS` beside it.

The quarantine comes with the sync too, as `scripts/harden/upstream-eligible.sh`, and asks about your own upstream (`UPSTREAM_REPO`, `UPSTREAM_BRANCH`). The reviews that ship with the app expect it on your working branch. A fork whose app is newer than its working branch does not have the helper yet: its reviews then stop before fetching anything and say so, and you bring in that one sync by hand (README, "How syncs get reviewed and merged") or tell the review that you waive the quarantine for it.

`VERSION`, `CODEHARDEN-CHANGELOG.md` and `state/` are your own in a fork: a release writes them and refuses when something else changed them since, so a sync that changes one is not merged by the workflow. CodeHarden changes them with every release, which is why a sync branch merges your working branch and keeps yours (the README's "How syncs get reviewed and merged").
