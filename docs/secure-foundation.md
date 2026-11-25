# Secure Foundation

**Secure Foundation** is the third choice of the add-project dialog. It creates a new project from the Secure Vibe Coding OS template ([harperaa/secure-vibe-coding-OS](https://github.com/harperaa/secure-vibe-coding-OS): Next.js, Clerk, Convex, optionally Doppler), runs the template's own install for you with the answers of one form, starts the app and gives you its URL.

It installs software from npm and creates resources in your Clerk, Convex and (if chosen) Doppler accounts. The form says what, right above its buttons, and nothing is created until you press **Go** and every check has passed.

The new project starts with **automatic work off**: apart from the setup session you pressed Go for, CodeHarden starts nothing in it by itself until you turn that on (see [Automatic work starts off](#automatic-work-starts-off)).

## The form

There is one form. With the defaults it takes two clicks: the option in the add-project dialog, then **Go** once you have typed a name.

| Field | What it is |
|---|---|
| Project name | Also the site's name. The folder is the name in lower case with dashes, inside your projects folder (`~/codeharden-projects`); the full path is shown as you type. A folder that already holds something is refused. |
| Admin email | Who signs in as the site's admin. Suggested from `git config user.email` on this computer when there is one; you can change it. It goes to the install and nowhere else. |
| Secrets | **Doppler** (preselected): the app's secrets live in a Doppler project. **.env.local**: they are written to a file in the project folder that git ignores. |
| App shell | **All modules** (preselected): every content module the template has. **Minimal**: none; add them later. **Pick**: a tick box per module. |
| Advanced › Deploy | Off unless you tick it. **Create a GitHub repository and deploy to Vercel** adds a private repository and a Vercel project and publishes the site (see [Deploy](#deploy)). |
| Advanced › Runs on | Which of your signed-in agent providers runs the setup. A provider that runs project command files runs the template's `/install`; any other reads the template's install instructions and follows them. |

**Advanced** is closed to begin with; its heading says what it holds ("Deploy off · runs on …"). Under the fields the form shows the template commit that will be installed (short id and date).

Above the buttons, always in view, four lines say what pressing Go does:

- what is created in your accounts, by kind ("Creates a Clerk app, a Convex project and a Doppler project in your accounts."), following your answers;
- that the setup session runs commands inside the new project without asking for each one;
- that the app's URL only works while the setup session's processes are running;
- that the new project starts with automatic work off (Manual mode).

**Details** beside them opens the verification view, which has the full lists. Pressing Go is your confirmation of these lines.

## Go

**Go** is green and can be pressed as soon as the name and the email are valid. One press does everything, in this order:

1. **The checks,** all in one pass (the button reads "Checking…"):
   - the form's answers, checked again by the server;
   - the folder: nothing may be there but an empty folder;
   - the template: its branch is resolved to a commit. If that isn't the commit the form showed, you are shown the new one first;
   - the provider that runs the setup is still signed in;
   - the sign-in of each service your choices need (Convex always, Doppler when chosen, GitHub and Vercel with the deploy).
2. **Only when every check passed:** the project is created and the setup session opens (the button reads "Creating…").

**If a check doesn't pass, nothing is created.** Go opens the verification view with what stopped it at the top and what to do about each item. Put it right there and press Go again; it runs the checks again and goes on.

Go also stops once, without anything being wrong, to show you a choice it made for you before it is used: the first of several Convex teams, the deploy's repository owner, name and Vercel scope, or a template commit newer than the one on the form.

If the create itself fails (the session can't start, say), what that attempt wrote is removed and you land in the same view with the server's reason.

## Requirements

When you open Secure Foundation, it first checks that this computer has what every setup needs. If it all is there, you never see this: the form opens. If something is missing, the **requirements page** comes up in front of the form, so you can put it right before anything starts instead of having the setup stop for it. **Settings › Secure Foundation Setup** (the last entry of the Settings sidebar) shows the same lists at any time, every row with its state, and so does the **Requirements** link at the top of the Secure Foundation dialog.

It has two lists, in the format of the first-run setup:

- **Tools on this computer:** Node.js (18 or newer), npm, git, and, marked as needed only for that option, the Doppler CLI (secrets in Doppler) and the GitHub CLI (Deploy). Each row says whether the tool was found and its version. A missing tool shows its install command to copy and run in a terminal yourself (it can ask for your password), and **Install guide** opens the tool's own install page. The Convex, Vercel and Clerk command-line tools run through `npx` at a pinned version, so they need nothing installed beyond Node.js.
- **Accounts:** Convex, Doppler, GitHub and Vercel show whether this computer is signed in, asked of each service's own command-line tool exactly as [Verify Settings](#verify-settings) asks. Signed out: **Sign in** starts that tool's own login (a link, and the code its page should show), and **Create an account** opens the service's sign-up page. Creating the account is all you need to do on their sites; Secure Foundation does the rest. **Clerk** is for after the install: the install creates an app without an account, and you only need a Clerk account afterwards, to [claim it](#claim-your-clerk-app). Its row is checked like the others, by asking Clerk's own command-line tool (`npx clerk@<pinned version> whoami --json`), and shows a green check when that tool is signed in. When it isn't, the row is not a failure: **Create or Sign-in** starts the tool's login (`clerk auth login`), which opens Clerk's page in your browser, where you can also create the account; the row turns green when it finishes. Three things to know:
  - Signing in to Clerk in your browser alone does not change the row: it is the command-line tool's sign-in that is asked.
  - Clerk's tool keeps its sign-in in the system keychain. Where it can't read it, it answers "not signed in" even after you signed in. So **I have an account** marks the row done yourself ("You said you have a Clerk account"), with **Undo**; that yes is kept in this browser only, and nothing about the account is stored.
  - For a brand-new Clerk account, Clerk's tool creates a first application ("My Application") when it signs in. That is the tool's own behaviour; the app Secure Foundation installs is a separate one.

  Signed in or not, the Clerk row never brings the page up, is not one of Go's checks, and the setup session never uses the Clerk tool. The email the tool prints is read as "signed in" and goes no further.

**Check again** runs the checks again; the page leaves by itself once everything every setup needs is there. It never holds you: **Continue anyway** goes on to the form, because Go and the setup session still make their own checks. Only what every setup needs (Node.js, npm, git, the Convex sign-in) brings the page up by itself. Something that only an option needs is listed and marked, and a check that failed or took too long reads as "couldn't be checked", with **Retry**, never as missing.

The checks run on the computer running CodeHarden only, with fixed commands (`node --version` and the like, and the sign-in checks' own). They answer found or not, a version number and signed in or not: no account name, and no token or password is asked for, shown, logged or kept. From another device the check is refused and the form opens as before.

A limit: the page looks tools up on the path your own shell sets up. A setup session can still find Node.js missing when the app was started from the Dock with a bare path (see below).

## Verify Settings

**Verify Settings** opens the verification view without starting anything. It runs the same checks and shows each as passed, needing you, or failed:

- **Form, Project folder, Template, Runs on:** what the server found, with the folder's full path and the commit.
- **One row per service:** whether this computer is signed in. CodeHarden finds out by asking each service's own command-line tool; it reads, copies and stores no token or session file, and the tools keep their own sign-ins.
  - **Signed out:** **Sign in to Convex** (or Doppler) starts that tool's own login. The row shows a link to the service's sign-in page, and the code that page should show; finish in your browser and the row turns green. A login waits five minutes at most and can be cancelled; either way no process is left running.
  - **Tool not installed** (Doppler): the row shows the install command for you to run in a terminal yourself, because it can ask for your password. Then **Check again**.
  - **Several Convex teams:** pick the team the project is created in. The first one is preselected.
- **What happens when you press Go:** where the project is created, the template commit that will be installed, that packages are installed from npm, what the setup session may do, and that the app's URL only works while the setup session's processes are running.
- **What is created in your accounts,** each item by name with where you remove it.

**Check again** runs the checks again, **Back to the form** keeps your answers, and **Go** is there too. **Cancel** or closing the dialog leaves nothing behind.

**If a row says Node.js isn't on the app's path:** an app started from the Dock or a launcher gets the system's bare path, without the folders your terminal adds (Homebrew, a Node version manager). The checks ask your own shell for its path every time, so this is rare; when it still happens, start CodeHarden from a terminal where `npx` works. The same goes for the setup session: if it reports that `node` or `npm` isn't found, quit the app, start it from such a terminal and send "continue" in the session.

The commands are fixed in the product: `npx convex@<pinned version> login status` and `login --login-flow poll --no-open`, `doppler me` and `doppler login`. Nothing you type becomes part of a command.

**From a phone or another device,** sign-ins can't be checked or started: that works on the computer running CodeHarden only. Go says so in the verification view. Without the deploy you can press Go again there to go on, and the setup session checks the sign-ins on the computer it runs on and asks you in the session; with the deploy ticked, Go doesn't go on from another device.

## What gets created, and where

- **On your computer:** the project folder, as a new local git repository with a single first commit. It has no remote, no link back to the template and none of the template's history. No GitHub repository is created. `node_modules`, and `.env.local` unless you chose Doppler, are written there by the install.
- **Clerk:** an accountless Clerk app with a JWT template and a webhook endpoint. It becomes yours when you claim it (below).
- **Convex:** a project named after your project, with a cloud dev deployment, in your Convex team.
- **Doppler** (if chosen): a project named after your project, with the configs `dev` and `prd`, holding the app's secrets. The install's "CI token" step (`doppler-create-ci-token`) can't store its token yet, because the project has no GitHub repository: in newer versions of the template it runs as the install says and defers, creating nothing; in older ones the setup leaves it out. Without the deploy it stays left for later: the session's last message and `docs/INSTALL.md` say to run `node scripts/setup.mjs doppler-create-ci-token` once the project has a repository. With the deploy it runs as soon as the repository exists.

## Deploy

With **Create a GitHub repository and deploy to Vercel** ticked, the setup also runs the template's dev deploy (`/deploy-to-dev`) after the install:

- The verification view gains two rows. **GitHub** needs the `gh` command-line tool, signed in with the `repo`, `workflow` and `read:org` permissions; a missing one gets a button that adds it. **Vercel** is asked through `npx vercel@<pinned version>`.
- Once both are signed in the view shows the **repository owner**, the **repository name** (the folder's name unless you change it) and the **Vercel scope** (the first team is preselected). The first Go always stops there so you see these names before anything is created with them.
- The **repository owner** is the template's question from `/deploy-to-dev` (its Step 1.5), asked here up front: your own account and the organisations you belong to (as `gh api user/orgs` lists them). The owner you picked for your last deploy is preselected while you still belong to it ("used last time"); otherwise your own account is. CodeHarden keeps only that name, in its home (`secure-foundation.json`). The setup session passes your choice to the template's `github-setup --owner` and then runs the template's Step 2.5 check that the repository landed there.
- **The owner decides which shared secrets the repository gets.** A repository in an organisation gets the secrets that organisation shares with its repositories, such as a token for the template's Claude reviews; a repository under your own account gets none of those, and you add each one yourself (see [Repository secrets](#repository-secrets-the-projects-workflows-need)). CodeHarden never reads or lists an organisation's secrets.
- The repository is created **private**. What is pushed is this project's own history: the single first commit and what the install adds, none of the template's.
- The Vercel project takes the repository's name and is connected to it, so later pushes to `main` redeploy.
- The site is **public** on a `vercel.app` address and runs on the development Clerk and Convex, the same ones as on your computer. On Vercel this uses the project's production slot, as the template's dev route does; nothing is deployed with production keys, and `/deploy-to-prod` is never run.
- With Doppler, the template's steps create two read-only service tokens for the Doppler `dev` config: `github-actions-ci`, stored as the repository's Actions secret `DOPPLER_TOKEN` (the template's `doppler-create-ci-token`, run once the repository exists), and `vercel-runtime-dev`, stored as `DOPPLER_TOKEN` on the Vercel project's development, preview and production environments, the only environment variable the setup adds there (Vercel or an integration of yours may add others of its own). The same deploy step adds `REVALIDATE_TOKEN` to Doppler and copies the Convex-bound values to Convex (`scripts/sync-convex-env.mjs`). Without Doppler, the app's environment variables, its development keys included, are copied to the Vercel project.
- That is the only repository secret the setup stores. The template's workflows use others, which GitHub doesn't copy from a template: the project page lists the ones the new repository doesn't have, with the steps to add each (see [Repository secrets the project's workflows need](#repository-secrets-the-projects-workflows-need)).

The verification view lists all of this by name. The setup session is given exactly those names and stops to ask if anything differs: another owner, a public repository, a production deploy. A repository or a Vercel project of that name that already exists is refused in the session's first part, before anything is created: nothing is pushed or deployed into it.

At the end you get two URLs: the local one, which only works while the setup session's processes are running, and the deployed one, which stays up. The project page shows both.

## The setup session

The setup is an ordinary agent session in the new project, called "Secure Foundation setup". It runs at the Full permission level: commands inside the project folder run without asking. It is told to refuse anything outside that folder, and CodeHarden's protected areas and always-ask rules apply as in every session (see [Security](security.md#permissions)).

It works in parts:

1. **A last check.** Node 18 or newer, npm and git; `npm install`; and that the sign-ins Go checked still hold. Only if one is missing does the session ask you (it lands in the inbox): a link to sign in to Convex, which team if you have several and chose none, to install the Doppler CLI or run `doppler login` yourself, or (with the deploy) to run the template's `gh auth` command for a missing GitHub sign-in or `workflow` permission. It never runs an installer that needs your password.
2. **The install,** without questions: the template's `/install`, phase by phase in its order, with your answers in place of its questions.
3. **The deploy,** only when you ticked it: the template's `/deploy-to-dev`, step by step in its order (see [Deploy](#deploy)).
4. **Starting the app:** the two dev processes (`npm run convex` and `npm run dev`, or their `:doppler` variants) as long-running processes of the session.

The session follows the template's two command files as they are written: every step, in their order, with the template's own commands and scripts. Where it does something else, the brief says so at that step and why; [How the setup follows the template](#how-the-setup-follows-the-template) lists every such place.

Its first message is the whole brief it was given: your answers, the list of what you agreed will be created, and the template's steps with your answers filled in. Its last message starts with the app's URL (and the deployed one), then the template's own summaries (the install's "Installation Complete!" with the Clerk claim link and its warning, and with the deploy "Dev Deployment Complete!"), what the template's Claude review workflows need on GitHub (with the deploy), how to stop and restart and anything left for later, and ends with **What was created**: each thing that now exists in your accounts, by name, with where to remove it.

The project page shows a **Secure Foundation setup** line: checking this computer, installing, waiting on you, running at the URL, stopped or failed. While automatic work is off, it says so under that line.

## How the setup follows the template

The setup session runs the template's own `.claude/commands/install.md` and, with the deploy, `.claude/commands/deploy-to-dev.md`, every phase and step in their order, with the template's own commands and scripts (`scripts/setup.mjs`, `scripts/modules.mjs`, `scripts/deploy.mjs`). Where a file asks you a question, the session uses your answer from the form, or, for the deploy's question about the Claude review token, the file's own recommended "Skip for now" where it has one. It does something else in only these places, each marked "Differs from the file" in its brief with the reason:

| Where in the template | What the setup does instead | Why |
|---|---|---|
| The sign-ins: Doppler's in the install's Doppler bootstrap, Convex's in its Phase 4, GitHub's in the deploy's Step 1.5 | They are checked first, before anything is created, with the template's own commands; only a missing one asks you | Each needs your own browser or terminal; checked first, everything after runs without you |
| Install, Doppler bootstrap: a missing Doppler CLI is installed with `brew` or Doppler's `sudo` installer | You install it yourself; the session asks you to | The `sudo` installer asks for an administrator password |
| Install, Phase 2: ask the four questions (and the module picker) | Your form's answers are passed in | You answered them in the form |
| Install, Doppler post-init: `doppler-create-ci-token` (older versions of the template, whose `/deploy-to-dev` has no secrets step) | Not run in the install. Without the deploy: left for later, with the file's own fallback in `docs/INSTALL.md` and the last message. With it: run right after the deploy's Step 2, then `write-install-summary` again so `docs/INSTALL.md` records it. (Newer versions: run in the install as written, where it defers and creates nothing; the deploy's own secrets step creates it once the repository exists) | It stores a token as a secret of the project's GitHub repository, and there is none yet; an older script would create the Doppler token with nowhere to store it |
| Install, Phase 6, Step 3: open the Clerk claim page and ask whether you claimed | The claim link and the file's warning go into the last message | Claiming needs your own Clerk sign-in, and the session doesn't wait on you |
| Deploy, Step 0: ask whether to deploy again when `docs/DEPLOYMENT-DEV.md` exists | Stops instead (a new project has none) | Deploying again wasn't agreed |
| Deploy, Step 1: `doppler secrets --project $(node -p "require('./package.json').name") …` | The same command without `--project`, so the project `.doppler.yaml` pins is used | `package.json` still has the template's name, not the Doppler project the install created; the file's own Step 8 relies on `.doppler.yaml` |
| Deploy, Step 1 (without Doppler): read `.env.local` to check eight keys | The same check, printing only each name and whether it passed | No secret value is printed in the session |
| Deploy, Step 1.5: the session runs `gh auth login` or `gh auth refresh -h github.com -s workflow` itself | You run the file's command in your own terminal | It changes this computer's GitHub sign-in, outside the project folder |
| Deploy, Step 2: the repository is named after the folder, and retried as `<name>-app` if that exists | The name you confirmed; an existing repository stops the setup (checked before anything is created) | Only the names you confirmed are created |
| Deploy, the secrets step right after the repository exists, in the version whose `CLAUDE_CODE_OAUTH_TOKEN` question recommends generating the token in the session (`claude setup-token`), pushing one already set in the terminal, or skipping. (The current template recommends "Skip for now": the setup takes that answer and takes the file's own path, with no difference: it lists the repository's secrets by name, as the file does, and goes on) | No question and no token: the session only checks, read-only, whether the repository has the secret (`gh secret list --repo <owner>/<repo> --json name`, names only), takes the file's "Skip for now" path when it hasn't, and goes on with the deploy. The last message says whether it is set and, if not, how to add it (the same steps as [the project page](#the-names-it-knows)) | It needs your own Claude sign-in, you aren't watching, and generating or pasting the token in the session would put it into the session's transcript |

What the setup adds, without removing a template step: the checks that the repository and the Vercel project don't exist yet (the template's Step 5 would deploy into an existing Vercel project), the read-only check of `CLAUDE_CODE_OAUTH_TOKEN` right after the repository exists (with a template whose deploy has no secrets step), so the last message can say whether you still have to add it, the rules on secrets (no value printed, none on a command line), the folder and production limits, and starting the app at the end (the template's summary tells you to start it yourself).

**A default chosen on purpose.** The template's App shell question recommends **Minimal shell**; the form preselects **All modules** (`SECURE_FOUNDATION_DEFAULT_SHELL`). That is the product owner's decision for this form, not a departure from a template step: the question is still asked, and whatever you pick is what the install gets.

**What the template's two commands don't do, so the setup doesn't either:**

- **`CLAUDE_CODE_OAUTH_TOKEN`.** The setup never sets it: older versions of the template don't either, and where a newer `/deploy-to-dev` asks you for it, the setup only checks whether it is there (see the table above). The template's Claude review workflows (`claude-code-review.yml` on every pull request, `claude.yml` on @claude mentions) run on GitHub's servers and need it as a repository secret: you create the token with `claude setup-token` in a regular terminal window of your own, not inside a Claude Code session, and add it yourself (see [Repository secrets the project's workflows need](#repository-secrets-the-projects-workflows-need)), or choose as the repository's owner an organisation that already shares it with its repositories. Until then the template's workflows skip those reviews: a skipped review means no review ran (copies of the workflows from before that change fail them instead). Reviews you run inside CodeHarden use your own subscription on this computer and need nothing.
- **Branch protection** is the template's separate `/lockdown-main`, which asks whether you work alone or in a team.
- **Pre-commit hooks** are the template's separate `/setup-hooks`.
- **The `testing` branch** is created by the template's `/merge-to-testing` the first time you use it; until then its `sync-testing.yml` workflow finds no `testing` branch and does nothing.
- **Production** is the template's `/deploy-to-prod` (see [What isn't in it yet](#what-isnt-in-it-yet)). The setup never runs it, so its own secrets step (newer versions) doesn't concern the setup.

## Automatic work starts off

A project Secure Foundation creates starts in **Manual** [autonomy mode](software-factory.md), and in such a project CodeHarden starts no agent work by itself. The setup session runs because you pressed Go for it. Nothing else does:

- **The project manager is not woken.** Pull requests, issues and reviews that appear on GitHub don't start or wake the project's manager, and neither do updates from sessions. A new repository can get pull requests from a dependency bot within minutes; they wait for you. What arrives is kept, and the project manager reads it with its next turn. A wake-up the project manager scheduled for itself waits in the same way.
- **No automations and no triage.** Scheduled and event automations don't fire and new issues aren't triaged, as in every project in Manual mode. You can still run an automation by hand.
- **No factory.** The software factory and the dark factory only run in a project you put in that mode.

Everything you start yourself works as usual: sessions you start, messages you send to the project manager (it answers, and can start sessions for what you asked) and automations you run by hand. The follow-ups of a session you started (being told when its own pull request fails its checks, a retry after a turn failed for a passing reason) are settings of their own and are not changed by this.

**To turn automatic work on,** open the project and press **Turn on automatic work…** in its Secure Foundation setup card, or the mode button beside the project's name (it reads **Manual**). Choose **Assisted** and save. From then on the project behaves like every other Assisted project: updates from GitHub wake its project manager, which works at the Auto permission level and can start agent sessions, and the automations you enabled fire. What arrived while it was off reaches the project manager with its next turn: the next update that wakes it, your next message to it, or the next start of CodeHarden.

**To turn it off again,** set the mode back to Manual.

This applies to projects Secure Foundation set up; other projects are unchanged. A project made by an earlier version keeps the mode it has (Assisted, unless you changed it): set it to Manual to get the same quiet state.

## Claim your Clerk app

When the install is done, the project page shows **Claim your Clerk app**. On Clerk's page, click **Claim** only and sign in or create your Clerk account. Skip the setup checklist that page shows afterwards (API keys, environment variables, middleware, JWT template, webhook): the install already did all of it, and doing it again can overwrite a working configuration. The link is also in the project's `docs/INSTALL.md`.

## Repository secrets the project's workflows need

The template ships GitHub Actions workflows, and some of them read **repository secrets**: its two Claude review jobs, which run on every pull request, read `CLAUDE_CODE_OAUTH_TOKEN`, and its CI build reads `DOPPLER_TOKEN`. GitHub copies no secret from a template, so in a new repository a job like that is skipped or fails, on every pull request, until the secret is there.

Once the setup has finished (or stopped), the project's **Secure Foundation setup** card lists them under **Repository secrets**, beside the Clerk claim: every secret (`secrets.NAME`) and variable (`vars.NAME`) the project's own workflow files use, and for each one the repository doesn't have:

- its name, and what it is for when CodeHarden knows the name;
- which workflow files and jobs use it and when they run ("on every pull request", "only when someone mentions @claude"; the second only when every alternative of the job's `if:` tests for the mention with `contains(…, '@name')` and none is negated, otherwise the events are named);
- what happens until it is set;
- the steps to add it.

What is already set is named in one line ("Already set: `DOPPLER_TOKEN`"). The setup session's last message points here too.

**You add them; CodeHarden doesn't.** It never sets a secret, never asks you for a value, never puts one on a command line and never stores one, and there is no field to paste a token into. A value is typed on GitHub, or in your own terminal into `gh`'s prompt.

### The names it knows

| Name | What it is | How you add it |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | The sign-in of the template's Claude review workflows (`anthropics/claude-code-action`), which run on GitHub's servers: a token for your own Claude subscription, stored in the repository. The setup doesn't add it: creating it needs your own Claude sign-in, and the token would pass through the setup session's transcript. Without it the template's workflows skip those reviews (a skipped review means no review ran); copies of the workflows from before that change fail them shortly after they start, on every pull request. Reviews you run inside CodeHarden use your own subscription on this computer and don't need it. | 1. In a regular terminal window of your own, not inside a Claude Code session or another agent session (the command needs an interactive terminal, and a session would keep the token in its transcript), run `claude setup-token` (a command of Claude Code; it needs a Claude subscription) and approve the sign-in in your browser. It prints a token that is valid for one year and saves it nowhere: copy it. 2. Store it as the repository secret `CLAUDE_CODE_OAUTH_TOKEN`: the repository's **Settings › Secrets and variables › Actions › New repository secret**, or `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo <owner>/<repo>` in your own terminal, pasting the token when it asks (it isn't shown as you type). 3. Install the [Claude GitHub App](https://github.com/apps/claude) on the repository if it isn't there yet. These are the manual setup steps of Claude Code's own guide, [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions); `claude setup-token` is described on its [Authentication](https://code.claude.com/docs/en/authentication) page. |
| `DOPPLER_TOKEN` | A read-only Doppler token for the `dev` config, so the CI build can read the app's settings from Doppler. **The deploy stores it for you** when you chose Doppler (it is the one secret the setup adds, through the template's own step), so it normally reads "set". With `.env.local` there is no Doppler token and it reads "not needed here": the template's CI builds without it. | Only when it is missing in a Doppler project: in a terminal in the project folder run `node scripts/setup.mjs doppler-create-ci-token`, the template's own step (its `.claude/commands/install.md`, "Doppler post-init"). It creates the token in Doppler and stores it as the secret itself. |

**Any other name** (one the template adds later, or one of your own workflows) is listed the same way with the generic steps: **Settings › Secrets and variables › Actions › New repository secret** (for a variable: the **Variables** tab), or `gh secret set NAME --repo <owner>/<repo>` (`gh variable set …`) in your own terminal. What value it takes is for you to find out from the workflow that uses it: only its name is known.

### How it is checked

- **The workflow files are read as text,** in the project folder on this computer: `.github/workflows/*.yml` and `*.yaml`, at most 50 files of 256 KB each. Nothing of the project is run and no YAML is loaded. References are looked for where GitHub evaluates expressions (`${{ … }}` and `if:`), in the forms `secrets.NAME`, `secrets['NAME']` and `secrets["NAME"]`; comments are skipped, and so is text inside a quoted string of an expression (`'secrets.EXAMPLE'` is no reference), and so are `GITHUB_TOKEN` and every other `GITHUB_…` name, which GitHub provides itself. A job that hands all secrets to a workflow it calls (`secrets: inherit`) is reported as "Inherits all", since that workflow can use names that aren't listed.
- **GitHub is asked for names only,** through your own `gh`, with two fixed commands: `gh secret list --repo <owner>/<repo> --json name` and, when a workflow uses a variable, `gh variable list --repo <owner>/<repo> --json name`. A secret's value can't be read from GitHub at all, and a variable's is never asked for. The repository is the one the project is connected to.
- **When:** when you open the project's page once the setup is over, again when the project gets its GitHub repository, and whenever you press **Check again**. A result is shown again for five minutes before the page asks anew.
- **If GitHub can't be asked** (`gh` isn't installed or signed in, or the call fails) the names are still listed, marked "couldn't check", with the reason and the steps.
- **Without a GitHub repository** (Deploy off) the card says one line: which secrets the workflows use, and that they matter once the project has a repository. The steps appear when it has one.
- **From a phone or another device** you see the last result, read-only. Checking works on the computer running CodeHarden only, because it asks that computer's GitHub sign-in.

What it can't see: a secret your **organisation** shares with the repository or one held by a deployment **environment** (only the repository's own are listed, so such a name reads "not set"); a secret used only by a workflow that another workflow calls from a different repository; and workflow files on GitHub that differ from the ones in the project folder. A run that already failed stays failed after you add the secret: run it again on GitHub, or push again.

**A project made by an earlier version** shows the same list the next time you open its page on this computer, as long as it is connected to its GitHub repository. Once the setup session is long gone, the card stays on the page only while one of the names is still not set.

## Stopping and restarting the app

The app runs as processes of the setup session. **The URL only works while those processes are running.**

- **Stop:** stop the setup session (or ask in it to stop the two processes). Archiving the session or quitting CodeHarden stops them too. The status then reads "Stopped".
- **Start again:** send "start the app" in the setup session, or run the two commands yourself in two terminals in the project folder: `npm run convex` and `npm run dev` (with Doppler: `npm run convex:doppler` and `npm run dev:doppler`). The URL is in the second command's output.

The status follows the setup session: if the processes end while the session is still open and the agent doesn't notice, it can still read "Running".

## Dev preview

The URL above is the app running in the project folder. To see what a session changes while it works, set up a [dev preview](dev-preview.md): the app then runs the dev server in each session's own worktree, and one for the base branch on the PM thread.

Once the setup has finished, the project's **Secure Foundation setup** card shows **Set up the dev preview**. It opens the project's Settings › Dev preview with the fields filled in for this project: `npm ci` as the prepare command, and as the dev command `doppler run --project <project> --config dev -- npm run dev` with Doppler, or `npm run dev` with `.env.local`. Check them, press **Save…** and confirm with **Save and allow**; nothing is stored or run before that, and a preview then starts from the **Dev preview** switch at the top of a session or the PM thread. Switching that on before anything is stored offers the same values in the same confirmation. With `.env.local` you also copy that file into the preview's folder yourself, since git ignores it. [Why these values, and what stays for you](dev-preview.md#secure-foundation-projects).

**Convex is not part of a preview.** Keep the Convex dev process running yourself, in a terminal in the project folder: `npm run convex:doppler` (with `.env.local`: `npm run convex`). The setup session runs it for as long as its processes live. Every preview of the project uses that one Convex dev deployment.

## If something fails

- **Before the project exists** (a sign-in is missing, the template can't be fetched, the folder exists, the session can't start): the verification view marks the check that failed and says what to do, and what that attempt created is removed.
- **During checks and sign-ins:** the session stops and says what exists so far: the project folder, and nothing at Clerk, Convex or Doppler. Send "continue" in the session to resume.
- **During the install:** the session stops, names the step and says what was already created in your accounts.

## Removing the project

1. Stop the setup session, then archive the project in CodeHarden.
2. Delete the project folder.

Neither step removes anything from your accounts. Remove each there:

- **Clerk:** in the Clerk dashboard, after claiming the app. An app you never claimed expires by itself.
- **Convex:** in the Convex dashboard, in the project's settings.
- **Doppler:** in the Doppler dashboard, in the project's settings.
- **GitHub** (if you deployed): the repository's settings, Danger Zone.
- **Vercel** (if you deployed): the project's settings. Removing the project takes the site down.

## What isn't in it yet

- **Your own Clerk keys.** The install always creates the accountless Clerk app. The template's install takes existing keys only as command-line arguments, where other programs on the computer could read a secret key, so the form doesn't ask for them.
- **A production deploy.** The template's `/deploy-to-prod` (production Clerk, custom domain, billing) is yours to run when you are ready.

## For fork owners

The template is part of the fork's configuration: the build variables `TEMPLATE_REPOSITORY` (a GitHub `owner/repo`, default `harperaa/secure-vibe-coding-OS`) and `TEMPLATE_BRANCH` (default `main`). `TEMPLATE_REPOSITORY=none` builds without the option. Only that repository is ever fetched: no request can name another. The other defaults are one constant each in `packages/contracts/src/secure-foundation.ts`: `SECURE_FOUNDATION_DEFAULT_SECRETS`, `SECURE_FOUNDATION_SETUP_AUTONOMY`, `SECURE_FOUNDATION_REPOSITORY_MODE`, `SECURE_FOUNDATION_DEFAULT_SHELL` (the preselected app shell, `all`) and `SECURE_FOUNDATION_DEFAULT_DEPLOY` (whether the deploy option starts ticked). `SECURE_FOUNDATION_PROJECT_MODE` (`manual`) is the autonomy mode a new project starts in; while a project Secure Foundation set up is in that mode, its project manager is not woken (`isSecureFoundationQuiet`, and `holdsPmWakes` in `apps/server/src/services/secure-foundation/quiet.ts`).

The repository secrets with steps of their own are a table in `packages/contracts/src/secure-foundation-repo-secrets.ts` (`SECURE_FOUNDATION_KNOWN_REPO_SECRETS`): what each is for, what happens without it, the steps, and the page they come from. A template with other workflows needs no change to be listed, since every name is found by reading the workflow files; add an entry only to give a name steps of its own.

The template must have what the setup session's brief names: `.claude/commands/install.md`, `scripts/setup.mjs` with the subcommands `init`, `convex-setup`, `configure`, `doppler-bootstrap`, `doppler-sync-env-local`, `doppler-create-ci-token` and `write-install-summary`, `scripts/modules.mjs install`, for the deploy `.claude/commands/deploy-to-dev.md` and `scripts/deploy.mjs` (`check-tools`, `gh-context`, `github-setup`, `vercel-env-dev`, `vercel-deploy`, `write-summary`), and content modules under `templates/modules/<name>/module.json`. The brief names the template's phases and steps by their headings (Phase 1 to Phase 6 of the install, Step 0 to Step 8 of the deploy); a template that renames them needs the brief changed to match (`apps/server/src/services/secure-foundation/brief.ts` and `brief-deploy.ts`).
