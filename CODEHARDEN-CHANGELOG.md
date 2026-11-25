# CodeHarden releases

## 2026.1124.2205 — 2026-11-24 22:05

### codeharden
- fix(automations): the shipped sync reviews name no repository
- feat(automations): stagger a new project's scheduled starter automations
- fix(dev-preview): the switch offers nothing after a failed lookup, and shows the Secure Foundation notes
- test(automations): the upstream-sync reviews arrive through the started service's events
- feat(dev-preview): show the switch on every thread, off until a person switches it on
- feat(automations): ship the two upstream-sync review automations for hardened forks
- fix(desktop): refuse to pack installers as codeharden in a fork without PACKAGE_NAME
- fix(secure-foundation): the Clerk row says which command answered not logged in
- feat(dev-preview): fill in the settings for a CodeHarden checkout
- feat(secure-foundation): check Clerk with its own CLI, and show the Settings link on phones
- feat(secure-foundation): requirements page before the workflow starts
- fix(server): Secure Foundation follows the template's GitHub Actions secrets step
- fix(server): Secure Foundation checks the Claude token instead of asking for it
- docs(secure-foundation): note that preselecting All modules is the owner's decision
- feat(web): remember the deploy's repository owner and say what an organisation's repository gets
- test(server): pin that configure's manual steps reach the install summary and the last message
- fix(server): Secure Foundation follows the template's install and dev deploy step by step
- docs(harden): say exactly what the cooldown check does, and what the sync reviews do with its status
- fix(harden): close the ways around the release's cooldown check, and keep the sync flow unblocked
- fix(server): read quoted strings and negated mention tests correctly in the workflow scan
- fix(harden): review findings on the sync cooldown
- docs(secure-foundation): repository secrets the project's workflows need
- feat(web): show the missing repository secrets on the Secure Foundation card
- feat(server): list the repository secrets a Secure Foundation project's workflows use
- feat(contracts): the repository secrets a Secure Foundation project's workflows need
- docs(harden): the sync cooldown, where it is enforced and what is an instruction
- feat(harden): hold the 48-hour sync cooldown at the merge, on the pull request and at the release
- fix(web): make the dev preview settings' button follow the state
- ci: run the tests when the root README changes
- docs(readme): say CodeHarden throughout, credit the CodeDen repository on top
- Merge pull request #33 from harperaa/codeden/say-hi-9546
- fix(web): keep the dev preview link on the card after the setup session is archived
- feat(secure-foundation): fill in the dev preview's settings for a new project
- test(server): pin that a preview's commands get no input and no terminal
- ci: build the installers without any cache, and check the tag's commit right after checkout
- ci: write the signing job's steps out, read the gate with actions: read, require one branch rule
- ci: require an approval before the installers are signed and published

## 2026.1123.1325 — 2026-11-23 13:25

### codeharden
- docs(harden): mark release 2026.1123.1237 as superseded by the next release
- fix: review findings on the carried fixes, second round
- fix(secure-foundation): the project page keeps saying automatic work is off after the setup session leaves the snapshot
- fix: review findings on the carried fixes
- test(harden): drift guard for the command in message text, the fork's defaults and carried fixes
- fix(server): keep ignore-scripts and min-release-age for the update install
- fix(server): the project manager releases only factory holds it placed
- fix(providers): stricter handling in the approval check, and long commands read in one pass
- docs(harden): the fork's command, port and home in the remote-access, security and update guides
- fix(harden): name the channel's command in messages and hints
- feat(harden): ship the provider switch at a usage limit off
- feat(secure-foundation): new projects start with automatic work off

## 2026.1123.1237 — 2026-11-23 12:37

Superseded by the next release; not published.

### upstream (leonvanzyl/codeden)
- chore(release): 0.7.9
- fix(providers): classify credential reads through interpreters, package-manager tools and more wrappers (#642)
- chore(release): 0.7.8
- fix(providers): classify scripts on input, tool-run commands and run-time paths (#640)
- fix(server): keep the caller's npm settings out of the update install (#641)
- fix(providers): classify blocks, escapes, wrappers and more write tools (#639)
- feat: switch the orchestrator's and PMs' provider when theirs hits its usage limit (#638)
- feat: Start fresh for the orchestrator and project managers (#636)
- fix(providers): weigh every part of a command and ask for the most severe (#627) (#637)
- fix(server): refuse input to the sessions of an archived project (#635)
- fix: upload attached files so the agent gets a real file, not a bare name (#632)
- fix(providers): ask for commands run in a folder outside the worktree (#614) (#626)
- feat(web): apply a project's permission level to its open sessions (#634)
- fix(server): start a PM's session without a provider only on a ready one (#633)
- feat(server): support HTTPS through Tailscale Serve (#594)
- test(providers): read only complete lines of a fake agent's log while it is written (#631)
- fix(server): move the orchestrator and PMs to the provider chosen in settings (#581)
- feat: hold an issue out of the factory loop; PM stops aren't failures (#593) (#628)
- feat: built-in token saver setting (#602) (#610)
- fix(providers): ask for commands run in a folder outside the worktree (#621)
- chore(github): add issue templates that route security reports privately (#575)
- fix(providers): find CLIs in package managers' folders and show providers' real state (#630)
- bump @anthropic-ai/claude-agent-sdk to 0.3.330 (#572)
- fix(providers): prefer a CLI copy that meets the provider's minimum version (#584)
- fix(runner): stop compiling C# at runtime to read process working directories on Windows (#619)
- fix(providers): OpenCode's `/` menu lists and runs its commands and skills (#617)
- fix(runner): a replaced or closing runner writes nothing of the new runner's (#620)
- fix(server): let go a factory integrator its provider refused while its PR is in verification (#552)
- fix(providers): never start Cursor's browser login from a background check (#618)
- fix(desktop): inherit the macOS login shell PATH (#592)
- fix(desktop): point the macos host build at electron's dist folder (#560)
- feat(web): archive a project from its sidebar menu (#577)
- fix(providers): Auto asks after pops that may not go back, cmd start with a title, and shells started by Start-Process (#550) (#553)
- fix(providers): explain OpenCode's "Model unavailable" and refuse bare model ids (#586)
- fix: say which sessions a project's permission level doesn't reach (#568) (#583)
- feat(server): list the loaded providers in start_session's provider parameter (#582)
- fix(providers): resolve Codex approval paths from the command's working directory (#591)
- fix(server): recognise more test file names in the factory's tests check (#579)
- fix(server): serve artifacts whose names hold non-Latin-1 characters (#580)
- test(runner): read the stalled server's socket so it sees the link drop (#578)
- fix(runner): stop a replaced or hung runner so two never share a home (#590)
- fix: per-project automation last run (#605) and failed-launch toast (#606) (#616)

### codeharden
- fix(server): closing the app waits for previews that are still stopping
- fix(harden): slash commands in OpenCode sessions are sent as plain prompts for now
- fix(server): dev preview follow-ups from review
- feat(server): dev preview rules for starting, stopping and removing
- refactor(server): a preview's processes are ended one by one, each checked against its start time
- fix(web): the dev preview setup hint is a plain link
- fix(server): close the gaps an independent review of the dev preview found
- fix(server): a preview always starts with the command confirmed at that moment
- docs(harden): the dev preview user page, changelog note and guide entries
- feat(harden): a dev command for this repository that takes its ports from the environment
- feat(web): dev preview bar, project settings and limits
- feat(server): dev preview service, routes and contracts

## 2026.1123.1155 — 2026-11-23 11:55

### codeharden
- fix(secure-foundation): closing the dialog ends a Go, and answers edited during a check are checked again
- style(contracts): format the Vercel variable assertion
- fix(secure-foundation): the Doppler token is the only Vercel variable the setup adds
- docs(secure-foundation): comments name the sign-in checks, not a step
- fix(secure-foundation): keep the buttons in reach and show the check's own message on sign-in rows
- test(server): a left-out fake CLI is missing whatever the machine has installed
- docs(harden): a session may sign in to npm for a publish the owner asked for
- fix(harden): the npm release explains a publish E404 and names the sign-in fix
- feat(secure-foundation): one form with Go and a verification view
- test(server): the missing-CLI tests don't find a tool the machine has installed
- docs: checks before a push and in CI, and one request, one pull request
- ci(harden): the pre-push hook runs typecheck and lint only
- ci: run the tests for pull requests into the working branch again
- docs(harden): keep the hook and gate text changes to the sync skip alone
- fix(harden): an allowed line of the drift guard can name two paths
- fix(harden): the pre-push hook lets a sync branch through
- test(harden): the drift guard fails when the vision file is upstream's again
- docs: the project vision is CodeHarden's own

## 2026.1123.0947 — 2026-11-23 09:47

### codeharden
- fix(cli): the warning about an installed version that can't start names the product
- fix(harden): the update banner of a source build says CodeHarden and no longer reports a false update

## 2026.1123.0930 — 2026-11-23 09:30

### codeharden
- fix(web): don't promise a closing list from a setup that stopped early
- feat(harden): the Secure Foundation setup ends with what was created and where to remove it

## 2026.1123.0917 — 2026-11-23 09:17

### codeharden
- fix(harden): never drop a ticked deploy, start one login per service, and word the clone mode truthfully
- docs: the deploy option of Secure Foundation
- feat(web): the deploy option in the Secure Foundation form, off by default
- feat(server): GitHub and Vercel connections, the deploy part of the setup brief and the deployed URL
- feat(contracts): the deploy option of Secure Foundation: the repository, the Vercel scope and what gets created
- fix(server): find the services' CLIs on the person's shell path, read afresh at each check
- docs: the Connections step of Secure Foundation
- feat(web): the Connections step of the Secure Foundation form
- feat(server): ask each service's own CLI whether it is signed in, and run its login from the form
- feat(contracts): the Connections step of Secure Foundation: sign-in state, logins and the Convex team
- fix(harden): make the Secure Foundation folder name in one pass, and never clean up through a link
- test(providers): record the project-commands capability in the Claude fixtures
- docs: Secure Foundation user guide, the fork's template variables and the changelog note
- test(harden): guard the Secure Foundation slots against upstream merges
- feat(web): the Secure Foundation option, its form and confirm step, and the setup status on the project page
- feat(server): create a project from the Secure Foundation template and start its setup session
- feat(contracts): Secure Foundation contracts, the template in the fork's configuration and a capability for project command files

## 2026.1123.0059 — 2026-11-23 00:59

### codeharden
- fix(harden): count the card surface for the wordmark's contrast, and tidy two string replacements
- feat(harden): a red and white shield logo, the CodeHarden wordmark and its own icons
- test: run the installer build step's signing guards, not just read them
- docs: sign a release cut after the strict signature check
- ci: give each system's installer build only its own signing secrets

## 2026.1123.0007 — 2026-11-23 00:07

### codeharden
- test(harden): guard the page and manifest the build names
- ci: take the expected page title from the build's own product name
- ci: expect the product's own name in the served page's title
- feat(server): give Docker sandboxes the fork's own names
- feat(web): name the page and the installed web app after the product
- test(harden): follow strings when skipping comments, check every define block
- docs: how the fork's changes are kept through upstream merges
- test(harden): fail when an upstream merge brings upstream's identity back
- docs: how the desktop installers of a release are built and published
- ci: add a manual workflow that builds the desktop installers of a release

## 2026.1122.2302 — 2026-11-22 23:02

### codeharden
- docs: CodeHarden's own home and app identity, next to CodeDen
- feat: CodeHarden runs as its own app, with its own home, port and app id
- feat(contracts): give the fork its own install identity in the channel module

## 2026.1122.2240 — 2026-11-22 22:40

### codeharden
- docs: how to make your own hardened fork
- feat(sync): add setup-fork.sh to set a hardened fork up on GitHub
- feat(sync): read the upstream, the branches and the package from repository variables
- feat(release): take the release repository from origin and the docs branch from the build
- fix(ci): keep git's hook variables out of the local test run
- ci: run the tests locally before a push while CI's test step is switched off
- docs(release): the owner can ask an agent to run the publish and open npm's approval page
- ci(sync): leave sync pull requests that touch scripts/harden/ for a manual merge

## 2026.1122.2133 — 2026-11-22 21:33

### codeharden
- feat(release): add release.sh and publish.sh, and run release.sh from the sync workflow
- feat(release): add the manual npm release script and skill
- chore(github): link the CodeHarden Skool community from the issue chooser
- chore(github): add issue templates that route security reports privately
- fix(updates): encode the package name as one segment of the registry URL
- style(server): format the registry query
- fix(updates): escape every slash in the registry query and match the API host exactly in the test
- docs: name the codeharden package, command and repository in the user docs
- docs: point the desktop download links at the channel's releases and add the changelog note
- feat(web): build release, docs and command text from the update channel
- feat(desktop): update from the channel's GitHub releases, quietly without a feed
- feat(updates): self-update from the channel's npm package
- feat(contracts): add the update channel module and its build-time define
- docs: add the changelog note for the version display
- feat(desktop): show the version line in the window title, About and the start-up lines
- feat(web): show the version line in Settings > About from the server's fields
- feat(cli): show the CodeHarden and upstream versions in --version, help, doctor and the start-up line
- feat(server): report the CodeHarden and upstream versions in health and the snapshot
- build: inject the CodeHarden version from VERSION at build time
- feat(contracts): add the CodeHarden version module and version API fields
- fix(providers): locate a supported CLI copy before a runner's first session
- docs: a review started from a session is Read-only; PM and factory sessions take the project's default
- docs: what the autonomy mode changes about approvals, and where other levels come from
- test(server): cover the back-off states the provider listing really shows
- fix(server): say exactly what start_session and defaultProvider do with a provider id
- docs: say exactly when a role session moves provider and what is dropped
- fix(server): keep a retired role session retired, and leave one with a message on its way
- docs(server): say exactly which artifact names failed before (#68)
- docs(server): state the tests check's test-file rules and limits exactly
- docs(workbench): say which shells start as a login shell on macOS
- test(providers): cover every shell that starts as a login shell on macOS
- docs: say which sessions block archiving a project
- fix(web): block archiving a project for every working session status
- fix(server): refuse to archive a project with working sessions
- refactor(contracts): share the list of active session statuses
- fix(providers): prefer a CLI copy that meets the provider's minimum version
- feat(server): list the loaded providers in start_session's provider parameter
- docs: where a session's permission level comes from
- test(providers): sed that only prints runs freely at Auto
- fix(server): update_project says existing sessions keep their level
- fix(web): name the open sessions a project's permissions don't reach
- fix(server): serve artifacts whose names hold non-Latin-1 characters
- fix(server): recognise more test file names in the factory's tests check
- fix(server): move the orchestrator and PMs to the provider chosen in settings
- test(runner): read the stalled server's socket so it sees the link drop
- feat(web): archive a project from its sidebar menu
- fix(runner): start macOS terminals as a login shell

## 2026.1122.2006 — 2026-11-22 20:06

### upstream (leonvanzyl/codeden)
- starts from 91155115: Auto: `Invoke-WebRequest … -OutFile <outside>` and PowerShell's `${C:\path}` file syntax read and write files outside the worktree without asking (#548)

### codeharden
- ci: release CodeHarden after merged upstream syncs
- ci: merge approved upstream sync pull requests after 48 hours
- docs: introduce CodeHarden
