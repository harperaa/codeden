> **CodeHarden** is a hardened fork of [CodeDen](https://github.com/leonvanzyl/codeden) by Leon van Zyl.
> It stays close to upstream: an upstream change is taken only after it has been public for 48 hours,
> then reviewed for security and function, and merged 48 hours after it is approved. The release script refuses a change that was merged
> sooner, unless the owner waived the wait for it, on the record ([how](docs/codeharden-sync-cooldown.md)). CodeHarden versions are timestamps; the app's own
> version number stays upstream's. It is its own app: its data is in `~/.codeharden`, it listens on
> port 4417, and it installs and runs next to CodeDen ([how they stay apart](docs/desktop.md#next-to-codeden)).
> The README below is derived and adapted from the [CodeDen repository](https://github.com/leonvanzyl/codeden).
> Want the same for your own changes? See [Make your own hardened fork](#make-your-own-hardened-fork).

<div align="center">

# CodeHarden

**One home for all your coding agents.** Start with a single agent helping you code. Run several at once, across every provider and project. When you're ready, turn your backlog over to a software factory, or let a dark factory find the work and do it on its own.

[![Website](https://img.shields.io/badge/website-codeharden.app-e8a33d)](https://codeharden.app)
[![npm](https://img.shields.io/npm/v/codeharden?color=e8a33d&label=npm)](https://www.npmjs.com/package/codeharden)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 24+](https://img.shields.io/badge/node-%3E%3D24-339933)
![Windows, macOS, Linux](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-555)

</div>

![An agent session: the conversation on the left, the changes the agent made on the right](docs/images/session.png)

```sh
npx codeharden
```

That's it. CodeHarden opens in your browser and uses the coding agents you already have installed and signed in. There's no account to create, no license key, no cloud service and no tracking. Everything stays on your computer.

Prefer an app? **[Download the desktop app](https://github.com/harperaa/codeharden/releases/latest)** for Windows, macOS or Linux. It's the same CodeHarden in its own window, with notifications and automatic updates, and you don't need Node.js.

---

## Contents

- [What is CodeHarden?](#what-is-codeharden)
- [It grows with you: four levels](#it-grows-with-you-four-levels)
- [Works with the agents you already use](#works-with-the-agents-you-already-use)
- [Everything you need in one place](#everything-you-need-in-one-place)
- [Safe by default](#safe-by-default)
- [Get started](#get-started)
- [FAQ](#faq)
- [Documentation](#documentation)
- [Contributing](#contributing) · [License](#license)

## What is CodeHarden?

Coding agents like Claude Code and Codex are powerful, but they live in separate terminal windows. It's hard to keep track of what each one is doing, what it changed and what it cost, and harder still to run several of them at once without them tripping over each other.

CodeHarden is the workspace around your agents. It gives every agent its own safe copy of your code and shows you what it's doing as it works. It collects every question, approval and finished pull request in one inbox. And it grows with you, from one agent to a factory that works through your issues while you do something else.

## It grows with you: four levels

You don't have to choose how big to go up front. Start small, and move up a level when you're ready. Every level keeps everything visible, so you always know what your agents did and why.

### 1. A single agent station

Open a project and start a session. You chat with an agent and watch it work. Its changes appear turn by turn, and you can see every file it touched.

- **Your code is never at risk.** Each session works in its own copy of the project on its own branch, so your own checkout is never touched.
- **Undo anything.** Every turn is saved, so you can roll files back to any earlier point.
- **Everything at hand.** The changes, the files, a terminal and a built-in browser sit next to the chat. The agent can open your app in the browser, click around and send you screenshots.
- **Plan first if you like.** On providers that support it, the agent proposes a plan and only starts changing code once you approve it.

### 2. Many stations, across providers and projects

Run as many sessions as you like, side by side, with different agents on different projects. Put Claude Code on one task and Codex on another, or ask a second agent to review the first one's work.

- **An orchestrator** you can talk to about all your projects at once ("what's going on?", "start a session to fix the login bug").
- **A project manager for each project.** It sorts incoming issues, starts sessions, keeps an eye on them and comes to you when it's unsure.
- **One inbox** for everything that needs you: questions, approvals, pull requests ready for review, failed runs and budget alerts.
- **No duplicate work.** If you start something that's already running, CodeHarden asks whether to wait, skip, join or start anyway.
- **Hand off between providers.** When one agent hits its usage limit, carry on in another with the same code and a summary of the work so far.

![Asking the orchestrator what's going on across projects](docs/images/orchestrator.png)

### 3. A software factory

Turn on the software factory for a project, and the GitHub issues you file become pull requests. You file an issue, and a team of agents takes it from there:

- **Bugs** are reproduced with a failing test, fixed, and reviewed.
- **Features** are planned, built to a spec with tests, and reviewed.
- **Docs changes** are written and checked.

Every pull request comes with its test results, and screenshots when the look of the app changed. A second agent, usually on a different provider, reviews the work before it reaches you. You merge it, or switch on auto-merge and let the factory merge it for you. Only issues from people you trust are picked up.

![The factory panel: the live Bug, Feature and Docs pipelines, the agent pool and the budget](docs/images/factory-panel.png)

### 4. A dark factory

A dark factory doesn't wait for you to file issues. You write down your vision for the app, and a scout regularly reviews the app against it. It files issues for what's missing or broken, and the factory builds them. You set the direction and the limits, then step away.

- **Watch it work.** The Factory view shows every agent at its station as work moves from intake to merge, as a board or as a 3D factory floor.
- **Stay in control.** Set how many agents run at once and a daily budget. Mark the areas agents must never touch. The factory pauses itself after repeated failures, and one click stops everything.
- **It learns.** Reviewers note the rules of your codebase, so later agents get them right the first time.

Both factory levels are **experimental**. Try them on a test repository first. Read [The software factory and the dark factory](docs/software-factory.md) before you start.

## Works with the agents you already use

CodeHarden runs the coding agents you already have, with the logins you already have, including your subscriptions. You don't need API keys.

| Agent | What you need |
|---|---|
| [Claude Code](https://docs.claude.com/en/docs/claude-code) | `claude`, signed in with a Claude subscription or an API key |
| [Codex](https://developers.openai.com/codex/cli) | `codex`, signed in with ChatGPT or an API key |
| [OpenCode](https://opencode.ai) | `opencode` 2.2+, which can reach many more model providers, including models running on your own machine |
| [Cursor](https://cursor.com/docs/cli/overview) | The Cursor CLI (`agent`), signed in with your Cursor account |
| [Gemini CLI](https://geminicli.com) | `gemini` 0.68+, signed in with your Google account |

Mix and match freely. Each session picks its own agent and model, and the factory can build with one provider and review with another. You need at least one of them. The setup screen tells you which are ready and how to fix the rest.

## Everything you need in one place

- **Every change, visible.** See exactly what each turn changed, comment on lines and send your comments back to the agent, then commit and push from CodeHarden.
- **GitHub, built in.** Agents open pull requests that link the issue and include their evidence: screenshots and test output. Review and merge without leaving CodeHarden.
- **Automations.** Switch on background jobs per project, like a security audit, dependency updates, a UI review or issue triage. They run on a schedule or when something happens. Write your own in a few lines of Markdown. Everything is off until you turn it on.
- **Know what it costs.** A usage report shows tokens and cost across providers, models and projects, with daily charts, budgets and alerts. Subscription logins show what the same work would cost on the API.
- **Your agents' setup, in one editor.** Edit memory files (`CLAUDE.md`, `AGENTS.md`), skills, subagents, MCP servers and hooks for each provider. Changes go into the provider's own files, so they work in the terminal too.
- **Images for any agent.** Every agent can generate images, whatever its provider. A Claude agent building a landing page can make its own hero image.
- **Talk instead of type.** Dictate with push-to-talk, and have an agent's reply read aloud when it's done.
- **Next-step suggestions.** When an agent finishes, CodeHarden suggests a few follow-up prompts you can send with one click.
- **From your phone.** Turn on network access, scan a QR code, and check on your agents from your phone or tablet.

![The inbox with a conflict, an approval and a pull request ready for review](docs/images/inbox.png)

![The usage report: totals, daily spend by model and a breakdown per model](docs/images/usage-reports.png)

## Safe by default

- **Private.** CodeHarden runs on your computer. Your code and conversations stay there. No account, no cloud service, no tracking.
- **Locked to your machine.** Only your own computer can reach CodeHarden, and every request needs a secret key unique to your install. Phone access is opt-in and password protected.
- **Risky actions ask first.** By default agents can edit and run ordinary commands in their own copy of the code. Anything risky comes to your inbox for approval first: changing files outside the project, force-pushing, deleting branches, installing software globally, or touching secrets.
- **No stored logins.** CodeHarden uses your agents' and GitHub's own sign-ins and never stores them. Optional API keys go in your operating system's keychain.

Full details: [Security](docs/security.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Get started

**You need**

- **Node.js 24 or newer** (not needed for the desktop app)
- **git**, with your name and email set
- **At least one coding agent**, installed and signed in (see the table above)
- *Optional:* the **GitHub CLI** (`gh auth login`) for issues, pull requests and the factories
- *Optional:* **Chrome or Edge** for the built-in browser

**Run it**

```sh
npx codeharden
```

Or install the **desktop app** from the [latest release](https://github.com/harperaa/codeharden/releases/latest): `CodeHarden-Setup-<version>.exe` on Windows, a `.dmg` on macOS, an AppImage or `.deb` on Linux. If Windows or macOS warns about an unsigned app the first time, see [The desktop app](docs/desktop.md#unsigned-builds).

1. **The setup checklist** finds your agents, GitHub and git, and only asks about what's missing. Each problem has a one-click fix: an install command, or a **Sign in** button.
2. **Add a project.** Pick a folder on your computer, or paste a GitHub link to clone one.
3. **Start a session** and tell the agent what to build.

![The first-run setup checklist](docs/images/setup.png)

Something not working? Run `npx codeharden doctor` to check your setup from the terminal. For a full walkthrough, see [Getting started](docs/getting-started.md).

CodeHarden updates itself: when a new version is out, a banner offers **Update now**. Command-line options, settings files and update details are in the [Reference](docs/reference.md).

## FAQ

**Do I need API keys?**
No. CodeHarden uses your agents' own logins, including Claude, ChatGPT, Cursor and Google subscriptions. API keys are only an optional extra for some image and voice features. Check your provider's terms for how your plan may be used.

**Where does my data go?**
Nowhere. It stays on your computer, in `~/.codeharden/`. The only network traffic is your agents talking to their providers, GitHub (if you use it), and any optional image or voice services you turn on.

**Is there telemetry?**
No. CodeHarden sends no usage data anywhere.

**Does it work without GitHub?**
Yes. Sessions, the workbench and automations all work on local folders. Issues, pull requests and the factories need GitHub.

**Will it mess up my code?**
No. Agents work in their own copies of your project on their own branches. Your own checkout and branch are never touched.

**What if I close the terminal?**
Agents in the middle of a task keep going. Run `codeharden` again and it picks up where it left off. `codeharden stop` stops everything.

**Which platforms does it run on?**
Windows, macOS and Linux.

**Is the dark factory safe to leave running?**
It's experimental. Start with the software factory on a test repository with auto-merge off. Set a budget, the people you trust and the areas agents must not touch, and keep the stop button in reach. See [The software factory and the dark factory](docs/software-factory.md).

## Documentation

| Guide | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, setup, your first project and session |
| [The desktop app](docs/desktop.md) | Install, notifications, updates and where data lives |
| [Secure Foundation](docs/secure-foundation.md) | A new project from the Secure Vibe Coding OS template, installed and started for you |
| [Dev preview](docs/dev-preview.md) | Your project's dev server, started in a session's own worktree, with its address at the top of the session |
| [Orchestration](docs/orchestration.md) | The orchestrator, project managers and agent sessions |
| [Workbench](docs/workbench.md) | Changes, comments, undo, forks, hand-offs, files, terminal, browser and search |
| [GitHub](docs/github.md) | Issues, pull requests, checks, reviews and evidence |
| [Automations](docs/automations.md) | Background jobs, schedules and writing your own |
| [The software factory and the dark factory](docs/software-factory.md) | Modes, pipelines, trusted authors, the scout, the vision, limits and the stop button |
| [How the factory loop works](docs/factory-loop.md) | What the factory does step by step |
| [Agent configuration](docs/agent-config.md) | Memory, skills, subagents, MCP servers and hooks |
| [Voice and images](docs/voice-and-images.md) | Dictation, read-aloud and image generation |
| [Usage and costs](docs/usage-and-costs.md) | Reports, budgets and rate limits |
| [Phones, tablets and network access](docs/remote-access.md) | Using CodeHarden from your phone |
| [Security](docs/security.md) | The security model in detail |
| [Troubleshooting](docs/troubleshooting.md) | `doctor`, logs and common problems |
| [Reference](docs/reference.md) | Settings, data folder, command-line options and updates |
| [Architecture](docs/architecture.md) | How CodeHarden is built |

## Make your own hardened fork

CodeHarden follows CodeDen: upstream changes are mirrored daily, taken into a sync only once they have been public for 48 hours, reviewed, and merged 48 hours after approval, and the release script refuses a change that was merged sooner unless the owner waived it; releases are timestamps; npm is published by hand. You can follow CodeHarden the same way, with your own changes on top and your own npm package. Three repository variables and one script point the same machinery at your names.

| Variable | What it is | CodeHarden | Your fork |
|---|---|---|---|
| `UPSTREAM_REPO` | The repository you follow | `leonvanzyl/codeden` | `harperaa/codeharden` |
| `UPSTREAM_BRANCH` | The branch of it you follow | `main` | `harden` |
| `PACKAGE_NAME` | The npm package you publish; its last part is the command | `codeharden` | your own, for example `example-harden` |

Your fork has two branches that matter. `harden` is your working and default branch: upstream plus your changes, where upstream only ever arrives by merge. `mirror` is a pure copy of CodeHarden's `harden`, only ever fast-forwarded and never committed to. (CodeHarden's own mirror is `main`, named after the branch it follows; yours can't be called `harden` twice, so it is `mirror`. A `main` branch copied by the fork button is not used and can stay.) Other names: `--branch` and `--mirror-branch`, stored as the variables `HARDEN_BRANCH` and `MIRROR_BRANCH`.

1. **Fork** [harperaa/codeharden](https://github.com/harperaa/codeharden) on GitHub. Copying only the `harden` branch is enough.
2. **Enable workflows** in the fork: open its Actions tab and press "I understand my workflows, go ahead and enable them". GitHub asks this of every new fork.
3. **Clone it** and install the [GitHub CLI](https://cli.github.com), signed in as you (`gh auth login`).
4. **Run the script**, first as a dry run:

   ```sh
   scripts/harden/setup-fork.sh --package example-harden --dry-run
   scripts/harden/setup-fork.sh --package example-harden
   ```

   It creates the three variables, the `mirror` branch and the labels `sync-approved`, `sync-needs-review` and `sync-hold`, makes `harden` the default branch, enables Actions and the "Upstream sync merge" workflow, and disables the Release workflow (which stays disabled: nothing publishes from CI). Each step prints "already set" or "changed", so you can run it again at any time. It never force-pushes, never deletes anything and stores no token; what it may not do with your sign-in, it lists for you at the end.

**The Secure Foundation template.** The add-project dialog's [Secure Foundation](docs/secure-foundation.md) option installs one template repository, which is part of the build like the names above: your fork keeps CodeHarden's (`harperaa/secure-vibe-coding-OS`, branch `main`) unless you set the variables `TEMPLATE_REPOSITORY` and `TEMPLATE_BRANCH` to your own, and `TEMPLATE_REPOSITORY=none` builds without the option.

**How syncs get reviewed and merged.** Every day the workflow fast-forwards `mirror`. Upstream's newest commits are not taken at once: a commit is in quarantine until it has been on the branch you follow for 48 hours, by GitHub's record of when it arrived there, not by the date written in the commit. `scripts/harden/upstream-eligible.sh latest` asks GitHub and names the newest commit that is out of quarantine, without fetching any code; it is often not the newest one, and the rest follows on a later day. To take upstream changes, push that commit to a branch named `sync/...` and open a pull request into `harden`. Nothing is fetched or pushed without a yes: the helper has to succeed, say `eligible` and name a full commit id.

```sh
git fetch origin harden
answer=$(scripts/harden/upstream-eligible.sh latest); code=$?
state=$(printf '%s\n' "$answer" | sed -n 's/^state: //p')
commit=$(printf '%s\n' "$answer" | sed -n 's/^commit: //p')
if [ "$code" = 0 ] && [ "$state" = eligible ] && printf '%s\n' "$commit" | grep -Eqx '[0-9a-f]{40}'; then
  git fetch --no-tags https://github.com/<the repository you follow> "$commit" &&
    git push origin "$commit":refs/heads/sync/2026-01-05 &&
    gh pr create --repo <you>/<your fork> --base harden --head sync/2026-01-05 --title "sync: upstream to 2026-01-05"
else
  printf '%s\n' "$answer" | sed -n 's/^short: //p'   # why not, and when the next commit comes out
fi
```

On most days the answer is not a yes (nothing is out of quarantine, or GitHub could not say), and `commit` is then empty. Never hand git an empty or unchecked id: `git fetch <url> ""` fetches the remote's `HEAD`, which is upstream's newest commit, and `git push origin "":refs/heads/<branch>` deletes that branch.

Review it, then label it: `sync-approved` (the workflow merges it 48 hours later, if its checks pass and nothing was pushed since), `sync-needs-review` or `sync-hold` (it waits for you). So there are two waits, 48 hours before a sync and 48 hours after its approval, and an upstream change reaches a release about five days after it was pushed ([The quarantine](docs/codeharden-sync-cooldown.md#the-quarantine-48-hours-before-a-sync)). You can do the daily review yourself, or switch on the two automations the app gives a project that is a checkout of your fork: **Daily upstream sync: first review** asks which commit is out of quarantine, fetches upstream up to that commit only, opens the pull request, reads the changes and runs the checks, and **Daily upstream sync: second review**, a separate session, confirms the quarantine, checks that work and is the only one that sets `sync-approved`. Both arrive switched off, run in the same app instance and ask for one inbox approval per run for their private hand-off file ([The two review automations](docs/codeharden-sync-cooldown.md#the-two-review-automations)). The workflow only looks at the labels. Three things to expect:

- If the pull request conflicts, merge `harden` into the sync branch and resolve there. `VERSION`, `CODEHARDEN-CHANGELOG.md` and `state/upstream-base` are yours: a release writes them, and refuses when something else changed them since the last one, so a sync never changes them. They conflict once both sides have made a release, and before that the sync brings CodeHarden's newer ones: either way merge `harden` into the sync branch and keep yours (`git checkout harden -- VERSION CODEHARDEN-CHANGELOG.md state/`). A sync that still changes one is left for you, like the next kind. `README.md` conflicts often, because upstream edits its own: README conflicts resolve to the fork's wording; carry upstream's content changes over by hand.
- A sync that changes `scripts/harden/` (the release and sync scripts themselves) is never merged for you: it gets `sync-needs-review`, and you merge it by hand with a merge commit.
- A sync that changes a workflow file can't be merged, or mirrored, by the workflow's own token; its log says so and you do that one by hand.

**The 48 hours hold on every path.** An approved pull request shows them as the status "Sync cooldown": pending with the time it ends ("Cooling down until 2026-01-07 14:55 UTC (approved 2026-01-05 14:55 UTC)"), red when something was pushed after the approval, green by itself within the hour after the wait is over. A sync branch has no such status before it is approved, so that the review that approves it sees only real checks; the status is a clock, not a CI check. The workflow's merge and `scripts/harden/release.sh` ask the same rule (`scripts/harden/sync-cooldown.sh`). GitHub does not stop a merge by hand, and the syncs above have to be merged by hand, so the guarantee is at the release: the release script refuses a release in which upstream commits were merged before their 48 hours were over, came in without a pull request, or were squashed or rebased in. It says which, and from when it would have been allowed. The only way around is the "Waive sync cooldown" workflow, for one upstream commit at one head: its run waits for your approval in a GitHub environment named `sync-waiver`, which you create yourself (Settings › Environments: yourself as required reviewer, the administrators' bypass off, only your `harden` branch, no secrets), and the release that ships the change records the waiver in its changelog entry. In a repository an organization owns, the variable `SYNC_WAIVER_APPROVERS` names who may waive. Merge syncs with a merge commit, never squashed or rebased. [The 48-hour cooldown](docs/codeharden-sync-cooldown.md) has the details, and what is enforced by code and what by instruction.

**Releases and npm, under your name.** After the workflow merges a sync it makes a release on `harden` (a commit, a tag `v<version>` and a changelog entry). After merging your own changes, make one yourself: `scripts/harden/release.sh --dry-run`, then `scripts/harden/release.sh --push`. Every release asks GitHub (with `gh`) about what was merged since the last one, and is refused when upstream commits among it had not waited. To publish a release to npm, check its tag out and run `scripts/harden/publish.sh --dry-run`, then `scripts/harden/publish.sh`, signed in to npm as the package's owner: [Publishing to npm](docs/codeharden-npm-release.md) has every step. Desktop installers for a release are built and attached by the "Desktop installers" workflow, run by hand: [Publishing the desktop installers](docs/codeharden-desktop-release.md). A dry run works at once. A run that publishes waits for an approval and reads its signing secrets from a GitHub environment named `release`, which you create yourself (Settings › Environments: required reviewers, only your `harden` branch, the secrets as environment secrets); the script doesn't create it and never touches a secret. A fork without certificates or without reviewers says so in two variables instead: `SIGNED_INSTALLERS=none` (publish unsigned installers) and `RELEASE_APPROVAL=none` (publish without an approval). The scripts read your variables from GitHub with `gh` (or from the environment), and refuse to release or publish in a repository that is not CodeHarden's until they are set, so your users are never updated onto `codeharden` by a default. Your fork is also its own app next to CodeHarden and CodeDen: the home folder (`~/.example-harden` written as one word, `~/.exampleharden`), the link scheme, the keychain service, the app id (`com.exampleharden.app`) and the app's name all come from `PACKAGE_NAME`. Three optional build variables name them exactly: `PRODUCT_NAME` (for example `Example Harden`), `APP_ID` and `DEFAULT_PORT` (CodeHarden's is 4417; pick another so both run at once). `scripts/harden/channel-define.mjs` has the details. The "CodeDen" wording inside the UI is not changed by any of this.

**Your changes survive the merges.** Your fork gets the same guard CodeHarden has: `scripts/harden/upstream-drift.test.mjs`, part of `pnpm test`, fails when a merge brings upstream CodeDen's own names back into the product (its npm package, repository, home folder, port, app id and the like), drops a place where the product reads its identity from the build, or puts upstream's wording back into this README. It compares against upstream's values only; your own names come from your variables at build time, so the test needs no changes in your fork while its README keeps this text. If you rewrite the README for your own product, change the test's `README_CREDIT` and `README_ALLOWED` to match. CI runs `pnpm test` on every sync pull request, so check that its run is green before you approve it. See "Keeping the fork's changes through upstream merges" in [AGENTS.md](AGENTS.md).

Optional: `git config core.hooksPath scripts/harden/hooks` runs typecheck and lint on your machine before each push. The tests run in CI, on pull requests into your working branch (see "Checks before a push and in CI" in [AGENTS.md](AGENTS.md)). The script doesn't set the hook.

## Contributing

Bug reports, ideas and pull requests are welcome, in [this repository](https://github.com/harperaa/codeharden/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) to get set up, [CODEHARDEN-CHANGELOG.md](CODEHARDEN-CHANGELOG.md) for what changed in each CodeHarden release, and [CHANGELOG.md](CHANGELOG.md) for upstream CodeDen's own changes.

## License

[MIT](LICENSE) © 2026 Leon van Zyl
