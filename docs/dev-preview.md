# Dev preview

A **dev preview** is your project's dev server, started by the app where a session works, with its address shown at the top of that session.

Every agent session works in a worktree of its own, so a dev server you started in the project folder never sees a session's edits. A dev preview runs the project's dev command inside the session's worktree instead, on ports the app picks, and the page reloads as the agent changes files, exactly as it does when you code in a terminal with `npm run dev` running.

There are two kinds:

- **A session's preview.** A switch at the top of the session turns it on.
- **The PM thread's preview.** A switch at the top of the PM thread turns it on. It shows the project's **base branch** (the project's own default branch, whatever it is called), from a checkout the app keeps for this, and follows the branch as it moves.

Both are **off until you switch them on**, and the switch is at the top of every PM thread and every session, whether or not the project is set up yet. Nothing runs for a project until you have confirmed its commands on this computer.

## Switch it on

Turn on **Dev preview** at the top of a thread.

| The project | What the switch does |
|---|---|
| Has confirmed settings | Starts that thread's preview. |
| Has none, and the app can suggest settings for it | Shows the suggested dev command, prepare command, port variables and where the link comes from, and asks **Run these commands on this computer?** **Save and allow** stores them and starts that thread's preview. **Cancel** stores nothing and leaves the switch off. **Edit settings** opens the project's settings, where you can change them first. |
| Has none, and the app has nothing to suggest | The strip says **Needs a dev command first**, and the switch opens the project's **Settings**, **Dev preview**. The app doesn't guess a command. |
| Has none, and the app couldn't find out what to suggest | The strip says **Couldn't check this project's settings**, with the link to the settings. Nothing is suggested, not even a `dev` script's command: the app first has to know whether Secure Foundation set the project up. Switching it on asks again. |

For a Secure Foundation project the question also lists what stays for you to do before the preview works (copying `.env.local`, keeping Convex running): the same notes the settings show.

The app can suggest settings for a checkout of [this repository](#this-repository-codeharden-itself), for a [Secure Foundation project](#secure-foundation-projects), and for a project with a `dev` script: a dev command and the prepare command that goes with it, by the lockfile it finds ([the table below](#set-it-up)). A project with a `dev` script and no lockfile is offered the dev command alone, and the dialog then says that there is no prepare command, which a fresh worktree usually needs. The suggested text is the app's own, never the repository's, and the question is the same one the settings ask: it is asked once per project, and again whenever the commands change. Settings stored from a session's switch leave the PM thread's preview off; stored from the PM thread's switch, they switch it on.

## Set it up

Open the project, **Settings**, **Dev preview**. This is also where you change what is stored.

| Field | What it is |
|---|---|
| Dev command | The command that starts the dev server, as you would type it in a terminal in the project: `pnpm dev`, `npm run dev`, `bin/rails server -p {port}`. |
| Prepare command | Optional. Run before the first start in a worktree, and again when a lockfile there changes: `pnpm install --frozen-lockfile`, `npm ci`, `bundle install`. A new worktree has no installed dependencies, so most projects need one. |
| Port variables | The environment variables the app puts the ports in. `PORT` by default. Name up to four, separated by commas, for a project that needs more than one port; each gets its own free port, and the first is the page the link opens. A name is upper case with `PORT` in it (`PORT`, `WEB_PORT`, `VITE_PORT`); other names are refused. |
| Link | **First port**: `http://localhost:<the first port>`. **From the output**: the first local URL the dev command prints, for dev servers that choose their own port. A pattern (a regular expression whose first group is the URL) narrows that down. An address on one of the app's own ports is never taken. |
| On the PM thread | Whether a preview of the base branch runs for the PM thread. Off until you switch it on, here or with the switch on the PM thread; your choice is kept. A project that was set up while this was on by default keeps it on. |

If the project has a `dev` script, the form offers commands to fill in, chosen by the lockfile it finds:

| Lockfile | Dev command | Prepare command |
|---|---|---|
| `pnpm-lock.yaml` | `pnpm dev` | `pnpm install --frozen-lockfile` |
| `yarn.lock` | `yarn dev` | `yarn install --frozen-lockfile` |
| `bun.lock`, `bun.lockb` | `bun run dev` | `bun install --frozen-lockfile` |
| `package-lock.json`, `npm-shrinkwrap.json` | `npm run dev` | `npm ci` |
| None of these | `npm run dev` | None is offered |

With more than one lockfile, the first in this order decides. These are fixed texts in the app: the repository decides only which row applies (that a `dev` script exists, and which lockfile is there), never what a command says. **Fill it in** only fills the fields, and what you typed in the prepare field stays. `yarn install --frozen-lockfile` is the one form every Yarn takes: Yarn 1 knows it, and later versions print a deprecation warning and treat it as their `--immutable`, which Yarn 1 doesn't know. If a later Yarn drops it, change the prepare command to `yarn install --immutable`.

For **settings that are stored without a prepare command**, the prepare field offers the one from the table with its own **Fill it in**. It changes nothing by itself: **Save changes…** and **Save and allow** store it, like any other change.

Two kinds of project open with the whole form filled in: a checkout of [this repository](#this-repository-codeharden-itself) and a [Secure Foundation project](#secure-foundation-projects).

The button under the form says what it will do:

| The form | The button |
|---|---|
| Nothing stored yet, and the fields hold a command (typed, or filled in for you) | **Save…**: it stores the commands and starts nothing, and a preview starts from the switch on a thread. With **On the PM thread** switched on it is **Start preview…**, in green, and the PM thread's preview starts with the save. |
| Stored, and you changed something | **Save changes…** |
| Stored and unchanged | No save button: there is nothing to save. The row says **Confirmed** and when, and how the PM thread's preview is doing. When that preview isn't running (stopped, failed, waiting for you), **Restart** or **Start preview** starts it right there, with the commands you already confirmed, exactly like **Restart** on the PM thread. When it can't be started from there, the row says why (the PM thread's preview is switched off, the project has no base branch). |
| Stored and unchanged, but the project's base branch changed since | **Confirm again…** |

**Start preview…**, **Save…**, **Save changes…** and **Confirm again…** all show the exact commands and the base branch first, and ask **Run these commands on this computer?** Only after **Save and allow** are they stored, and only then can a preview start; **Cancel** stores nothing. There is no way around that question: a command runs only after you confirmed it on this computer. Space around a command and the way port variables are separated are not kept, so they don't count as a change. Changing a command later asks again; previews that were running stop, the PM thread's starts again with the new commands when it is switched on, and a session's starts when you turn it on again. **Remove** forgets the commands, stops the project's previews and takes the base branch's checkout away, with the installed dependencies and build output in it. The checkout is kept, and you are told, when it has changes, untracked files, or an ignored file that can't be made again (an `.env.local` you put there). Archiving a project does the same as Remove.

### Ports in the command

Most dev servers read `PORT`. For one that takes its port as an argument, write `{port}` in the command, and `{port2}`, `{port3}`, `{port4}` for further ports:

```
vite --port {port} --strictPort
```

`{port}` is the first port and `{port2}` the second, in the same order as the port variables. Those placeholders are the only things the app ever replaces in your command, and only with a port number.

### This repository (CodeHarden itself)

`pnpm dev` uses two fixed ports, so two worktrees can't run it side by side. The repository has a script made for this, and for a project that is a checkout of it the settings open filled in:

| Field | Value |
|---|---|
| Dev command | `node scripts/harden/dev-preview/run.mjs` |
| Prepare command | `pnpm install --frozen-lockfile` |
| Port variables | `WEB_PORT, API_PORT` |
| Link | First port |

There is nothing to type, and no need to open the settings: switch **Dev preview** on at the top of a thread and press **Save and allow**. In the settings, the same values are stored with **Save…** and then **Save and allow**. Either way it is the same confirmation as for every project, and nothing is stored or run before it. You can change every field before you save; **Fill them in** puts the values back.

The values are the app's own, not the repository's. The app looks at the project folder only to decide whether to offer them: the root `package.json` has this workspace's name, and `scripts/harden/dev-preview/run.mjs` is there as a file. It reads nothing else for this, runs nothing, and takes no text from either file into a command. Another device is offered nothing.

**When the port variables are wrong.** The script needs both variables, the web app's first. With this dev command stored and other port variables (the form's default `PORT`, for example), a preview fails with `dev-preview: set API_PORT to a free port (1024-65535).` The settings then say so, and **Use the recommended settings** puts the right values in the form; **Save changes…** and **Save and allow** store them. The failed preview's strip links to the settings as well.

The script starts the server on `API_PORT` and the web app (Vite) on `WEB_PORT`, with the Fake provider on, and a home of its own in `.codeden-dev/preview/` inside that worktree, so a preview never touches your installed app's data, another worktree's, or the home `pnpm dev` uses in the same worktree. It refuses to start when a server already runs over that home. Stopping the preview also stops the runner that dev server started.

### Secure Foundation projects

A project that [Secure Foundation](secure-foundation.md) created needs more than `npm run dev`, so its settings open filled in. Once the setup has finished, the project page's **Secure Foundation setup** card shows **Set up the dev preview**. It opens these settings with:

| Field | Value |
|---|---|
| Dev command | With Doppler: `doppler run --project <project> --config dev -- npm run dev`. With `.env.local`: `npm run dev`. |
| Prepare command | `npm ci` |
| Port variables | `PORT` |
| Link | From the output |

Check the values, press **Save…** and then **Save and allow**; a preview then starts from the switch at the top of a thread. Switching **Dev preview** on at the top of a thread before anything is stored offers the same values in the same question. That is the same confirmation as for every project, and nothing is stored or run before it. When nothing could be filled in for the project (its name is not a plain one), the switch opens these settings instead. The values are a suggestion and only fill the form: the app builds them from the name you gave the project in the Secure Foundation form, which it kept in its home (`secure-foundation.json`) when it created the project. They are not read from the repository, and Secure Foundation never stores a dev preview's commands itself. You can change every field before you save. When a dev preview is already set up, nothing is changed; **Fill them in** in the settings puts the values into the form again.

Why these values:

- **`npm ci` as the prepare command.** A preview's folder is a fresh checkout without `node_modules`. Without a prepare command the dev command ends with `next: command not found`.
- **The Doppler project and config are named in the command.** In the project folder `npm run dev:doppler` works because Doppler remembers the project and the config per folder. A preview runs in another folder (a session's worktree, or the base branch's checkout), where Doppler knows neither and stops with `Doppler Error: You must specify a project`. The project is the one the install created (your project's name in lower case with dashes) and the config is `dev`. A name is only put into the command when it is a plain name: letters, digits, dots, dashes and underscores, starting with a letter or digit. Otherwise nothing is filled in and the form says why. The `doppler` command has to be on the path the app was started with, and signed in.
- **With `.env.local` there is one thing left for you.** Git ignores that file, so a preview's folder doesn't have it and the app starts without its keys. Copy it there yourself: into the session's worktree for a session's preview, and into the base branch's checkout for the PM thread's (the form shows that folder's path; it exists once that preview has started). The app doesn't copy secret files between folders. Whoever works in a folder, an agent included, can read what you copy there. Start the preview again afterwards.
- **The link comes from the output.** `next dev` listens on the `PORT` it is given and prints its address; the link is that address, once something answers there.
- **A project made before the app kept its secrets mode** gets the values for `.env.local`. If its secrets are in Doppler, change the dev command to `doppler run --project <your Doppler project> --config <your config> -- npm run dev`.

**Convex runs separately.** The dev command starts Next.js only. The Convex dev process is a second command, and no preview starts it: run `npm run convex:doppler` (with `.env.local`: `npm run convex`) in a terminal in the project folder and keep it running. The setup session runs it for as long as that session's processes live. All previews of the project, every session's and the PM thread's, use the same one Convex dev deployment, and that deployment has the Convex functions and schema of the folder the Convex command runs in: what a session changes under `convex/` is not in its preview until it is in that folder.

**It listens on your network, as in a terminal.** `next dev` listens on all network interfaces unless its command names a host (`-H`), and it doesn't read the `HOST=127.0.0.1` the app passes. A preview of such a project can therefore be reached from other devices on your network, exactly like `npm run dev` in a terminal. The filled-in command leaves that as the template has it.

## At the top of a session

| It shows | Meaning |
|---|---|
| The switch, off | No preview. Turn it on to start one; in a project with nothing stored yet it asks first ([Switch it on](#switch-it-on)). |
| **Needs a dev command first** | The project has no dev preview settings and the app has none to suggest. **Set up a dev preview**, or the switch, opens the project's settings. |
| **Preparing** | The prepare command is running in the session's worktree. |
| **Starting** | The dev command is running; nothing answers on its port yet. |
| **Running** and a link | Something answers on the port. The link opens it. |
| **Stopped** and a reason | It ran and ended: the dev command exited, the session was stopped or archived, or it was stopped to make room. **Restart** starts it again. |
| **Failed** and a reason | It never came up. The last lines of its output are shown underneath. When the dev command ended because a program of its own wasn't there (exit code 127, or a "command not found" line at the end of its output) and the project has no prepare command, the strip adds that the dependencies probably aren't installed in this checkout, with a link to the project's Dev preview settings. That is a hint: the app installs nothing and changes no settings by itself. |

**Log** opens everything the prepare and dev commands printed since the last start. The lines under a failed or stopped preview are only the last twelve, so an install that ran before the dev command is usually not among them: open **Log** to see it.

The link appears only once something is actually listening: the app tries the port instead of trusting that the command says it is ready. With **From the output** the address itself is the one the command printed, so it is as trustworthy as the project's dev script.

The preview keeps running while the agent works, whatever the agent restarts. If the dev command exits by itself, the app starts it again **once**; if it exits again, the preview says so and waits for you. It stops when you switch it off, when the session is stopped, fails or is archived, when its worktree is cleaned up, and when the app quits.

The strip is one row under the thread's header, the same on a session and on the PM thread. The switch is disabled, with the reason, on another device (which sees the state and the log and can stop a preview) and where a preview has nowhere to run: a session that works in the project folder instead of a worktree of its own (projects that aren't git repositories), a read-only session, a session in a sandbox, and a session that is stopped.

## On the PM thread

The PM thread's preview is off until you switch it on, with the switch at the top of the PM thread or with **On the PM thread** in the settings. Once on, it stays on (it comes back when the app starts) until you switch it off.

The base branch's preview runs from **a checkout of its own**, inside the app's home (`dev-preview/base/<project>`). It is never your project folder, and never a session's worktree.

- About every 90 seconds, and when you press **Update now**, the app fetches the base branch from the project's remote (for a project without a remote, it reads the local branch) and **fast-forwards** the checkout to it. The dev server's own reload picks the new files up. When the remote can't be reached the strip says so, the preview keeps running on the last tip, and the app asks less often until it answers again.
- It starts like a session's: the prepare command runs first in that checkout (**Preparing**, with its output in the log), then the dev command (**Starting**), then the link (**Running**). A prepare command that fails is reported with its exit code, and no dev command starts.
- The dev command is restarted only when it must be: when a lockfile changed, so the prepare command ran again, or after it stopped.
- **A project with automatic merges** (the factory's auto-merge setting) doesn't start this preview by itself: there the base branch moves without anyone reading the change, so the preview waits for **Restart** (on the PM thread, or in the project's Settings › Dev preview) once each time the app starts. Saving the settings counts as that start.
- It follows **the branch you confirmed**. Saving the settings records the project's base branch at that moment, and the dialog names it. If the project's base branch is changed later (the orchestrator can change it, and so can project settings opened from another device), the preview stops and says so, and runs nothing from the new branch until you confirm the dev preview settings again on this computer (**Confirm again…** in the project's settings).
- The app's own git commands in your project run without the repository's git hooks, and never prune or remove your other worktrees.
- The checkout only ever moves forward. If it can't be fast-forwarded, because someone committed in it, edited a file that the update would overwrite, or the branch was rewritten, the preview **stops with a message** and the checkout is left exactly as it is. The app never resets it, discards anything or deletes it. Sort the folder out (or move it away) and press **Update now**.
- A project with no dev command shows the switch, off, like every other. Switching it on asks with the settings the app can suggest, or opens the project's settings at **Dev preview** when it has none to suggest ([Switch it on](#switch-it-on)).

## Limits

**Settings**, **Dev previews**:

- **At once in a project** (3) and **at once in all projects** (6). The PM threads' previews count. When you start one over the limit, the app stops the oldest idle preview, which then says it was stopped to make room. A preview whose session is working is never stopped for this; if all of them are, the start is refused. A preview the app starts by itself (the PM thread's) never stops anyone else's.
- **Ports**: the range previews get their ports from (43100 to 43199). A port in use is skipped. The app's own port, 4417 and 4317, and the ports `pnpm dev` uses (4318, 4319, 5173, 5174) are never given out, whatever the range.
- **Stop all** ends every preview in every project. The PM threads' previews then stay stopped until you press **Restart** on one. Quitting the app also stops everything; the PM threads' previews come back when it starts again.

## What runs, and as what

Read this before you set a project up: a dev preview runs the project's code on your computer.

- **It runs the repository's code as you, with no approvals.** A session's agent works under the permission level you gave it; a preview doesn't. The dev command runs the project's dev script, and the prepare command runs the install scripts of the project's dependencies, with everything your user account can read and reach, the app's own files included. That goes for code an agent wrote in a session's worktree, the moment you turn that session's preview on. Turn a preview on for code you would run yourself.
- **Only commands you confirmed.** The dev and prepare commands are the ones you confirmed on this computer: typed in the project's settings, or the app's own suggestion shown to you when you switched a preview on. They are never read from the repository: not from `package.json`, not from `.codeden/project.json`, not from anything a branch or a pull request can change. A project you added from a repository you don't trust can't run anything through this feature until you type and confirm a command for it. Remember that the command then runs that repository's code: `pnpm dev` runs whatever its `dev` script says, in every worktree, including a session's branch that an agent wrote, and on the PM thread whatever is merged into the base branch, as soon as it is merged. For a checkout of this repository the form starts filled in with values that are fixed in the app ([above](#this-repository-codeharden-itself)): the repository decides only whether they are offered, never what they say, and they are stored by the same **Save and allow**. For a project Secure Foundation created, the form starts filled in too ([above](#secure-foundation-projects)): those values come from your own answers in the setup form, not from the repository, and they are stored by the same **Save and allow** as anything you type. The names they are built from are kept in the app's home (`secure-foundation.json`), behind the same guard as the commands; an agent that got past it could change which Doppler project the form suggests, so read the command in the dialog before you allow it. Only a plain name is ever put into a suggested command.
- **Only on this computer.** With network access on, a phone or another device sees a preview's state, its address and its log, and can stop it. It can't set or change a command, change the limits, start a session's preview, or switch on or update the PM thread's. The address is `localhost`, so it only opens on the computer running the app.
- **Only a person.** There is no agent tool for any of this. A session's preview starts only from your click on its switch, and never by itself: not when the session starts, not when the app restarts. An agent can't turn a preview on and can't change the command. The commands aren't part of the project's own settings, so the orchestrator's and PMs' project tools can't reach them, and the branch the PM thread's preview follows is the one you confirmed (above). They are stored in a file in the app's home (`dev-preview.json`), which agents are kept out of by the same guard as the app's other files; that guard has known gaps, listed under Permissions in [Security](security.md), and an agent that got past it could plant a command there.
- **Like your terminal, without the keyboard.** The command is handed whole to your own shell, in the worktree, with your environment minus the app's own variables. Nothing is added to the command text except the port numbers described above. Unlike a terminal, the command has no input and its output is not a terminal: nobody can answer a question it asks (see [Troubleshooting](#troubleshooting)).
- **Loopback.** The app picks ports that are free on this computer and passes `HOST=127.0.0.1`, which most dev servers obey. But a dev server listens however its command makes it listen: a command with `--host 0.0.0.0` is reachable from your network. Keep it on this computer unless you mean otherwise.
- **The output is yours.** A preview's log can hold whatever the project prints, secrets included. It is kept in memory only (the last 2,000 lines), shown when you open it, and never written into a transcript, an event or a file.
- **Nothing left behind, and nobody else's process touched.** Each preview runs in its own process group. Stopping it ends the processes of that group and everything they started, one by one, each only while it is provably the process the app saw (same id and same start time). If the app is killed or crashes, the next start ends what was left running under the same rule; a record it can't prove (from before a restart of the computer, or whose id now names another process) is dropped and nothing is signalled.

## Troubleshooting

- **A preview says Failed and the log ends in "command not found".** The command runs in your login shell, with the environment the app was started with. If `pnpm` or `node` is only on your path in a terminal, start the app from that terminal.
- **A preview says Failed and the log ends in `next: command not found`** (or another tool of the project itself). The preview's folder is a fresh checkout without the project's installed dependencies. Set a prepare command: `npm ci`, `pnpm install --frozen-lockfile`. The strip says so when the project has none, and the project's settings offer the one for its lockfile. With a prepare command set, press **Restart**: the app prepares again whenever what the prepare command installed is no longer in the folder.
- **The log ends in `Doppler Error: You must specify a project`.** Doppler remembers its project and config per folder, and a preview runs in another folder than your project's. Name both in the dev command: `doppler run --project <project> --config <config> -- npm run dev` ([Secure Foundation projects](#secure-foundation-projects)).
- **The log ends in a question** ("Upgrade now?", "Use another port? (y/n)", "Ok to proceed?"). A preview's commands have no terminal and no input: their input is closed, so a command that reads an answer gets the end of input at once, and their output is not a terminal. Nobody can answer in a preview.
  - Most tools check for a terminal first and don't ask. `next dev`'s upgrade menu ("Installed Next.js version … is affected by a known security vulnerability", then **Upgrade now**, **Skip**) is only shown in a terminal; in a preview it is skipped and the dev server starts.
  - A tool that asks anyway goes on with its default answer, or exits. Then the preview says **Failed**, "The dev command exited with code … before anything was listening", and the question is the last line of the log.
  - If the question is the last line and the preview stays on **Starting** (or **Preparing**) until its time limit, the command is not waiting for you: it waits for something else, such as the network or a lock. Run the same command in a terminal in that folder to see what.
  - Either way, answer where it can be answered: run the command once in a terminal in the project folder, or add the tool's own option for running without questions to the command.
- **The preview says "The dev command exited with code 1 and was restarted once", and the log has "This command stopped to show the upgrade recommendation".** That is Next.js when it finds an AI coding agent's variables in its environment: `next dev` then stops once with an upgrade recommendation and runs on the next try. A preview gets the environment the app was started with, so this can happen when the app itself was started from an agent's terminal. The one automatic restart is that next try, and the preview comes up; start the app from your own terminal or launcher to avoid it.
- **Preparing never ends.** The prepare command is ended after 15 minutes. Open **Log** to see what it waits for; a command that asks a question gets no answer, since it has no terminal.
- **The PM thread's preview says the base branch changed.** Open the project's Settings › Dev preview and press **Confirm again…**, then **Save and allow**: the commands are unchanged, and the preview follows the new branch.
- **The PM thread's preview says it can't be fast-forwarded.** Look at the checkout the message names. Commit elsewhere what you want to keep, put the folder back to the branch's tip or move it away, then press **Update now**.
- **Something still runs after the app crashed.** On its next start the app ends what it can prove it started: the dev command's own process, and through it everything that process started. If the dev command's own process died in the crash and only what it had started lives on, the app has no proof those processes are its own, and it leaves them rather than risk ending someone else's. End them yourself: `lsof -nP -iTCP:<port> -sTCP:LISTEN` shows what holds a preview's port.
- **A port is taken.** Previews skip ports in use. If the whole range is taken, widen it in Settings › Dev previews, or stop a preview.

## Limits of this version

- Previews run on the computer the app runs on. Sessions in a sandbox (Docker) have none.
- A prepare command that hasn't finished after 15 minutes is ended, and the preview fails.
- The prepare command runs again when a lockfile at the root of the worktree changes (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`, `Cargo.lock`, `go.sum`, `Gemfile.lock` and the like), or when you change the command. A session's preview checks when it starts; the PM thread's also after every update.
- It also runs again when what it installed is gone. The app notes which entries at the top of the folder the prepare command made or changed (`node_modules`, `.venv`), without knowing any name in advance, and prepares again before the next start when one of them is missing: a checkout that was made again, or dependencies someone removed. It looks at the top of the folder only, so an install that is damaged inside (a single package removed from `node_modules`) or that puts nothing in the folder is not noticed; change the lockfile or the command, or remove the installed folder, to prepare again. After updating from a version that didn't keep this note, every folder is prepared once more.
- A session's preview is off again after the app restarts; the PM thread's comes back by itself when you had switched it on.
- After a crash of the app, leftovers are found through the dev command's own process. If that process died too and only what it started lives on, the app can't prove those are its own and leaves them for you to end. On Windows nothing is cleaned up after a crash.
- The UI asks for a preview's state every few seconds while a thread is open, so a change can take a moment to show.
- Windows: previews start and stop there, but this version was only tested on macOS.
