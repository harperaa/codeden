# Contributing to CodeDen

Thanks for helping. CodeDen is plain TypeScript in a pnpm workspace, and most of it is written with coding agents, so the conventions below favour mainstream patterns that any agent (or person) can follow.

**Before changing behaviour, read the relevant sections of [docs/DESIGN.md](docs/DESIGN.md).** It is the locked design and the source of truth; anything in its "Locked decisions" table needs a design discussion (open an issue) first. [AGENTS.md](AGENTS.md) is the short version for coding agents.

## Development setup

You need **Node.js 24+**, **git**, and **pnpm 10** (`corepack enable` gives you the pinned version).

```sh
git clone https://github.com/harperaa/codeharden.git
cd codeharden
pnpm install
pnpm dev
```

`pnpm dev` starts the server on `127.0.0.1:4318` (data in `.codeden-dev/`, the scripted **Fake** provider enabled) and the Vite dev server on <http://localhost:5173>. Open the Vite URL; its proxy adds the dev install token for you.

To work on the UI with no server at all:

```sh
VITE_CODEDEN_MOCK=1 pnpm --filter @codeden/web dev
```

That runs the web app against an in-memory mock client (development only; builds always talk to a real server).

To try the built CLI exactly as users get it:

```sh
pnpm build
node apps/cli/dist/cli.js --home .codeden-try --port 4400
node apps/cli/dist/cli.js doctor --home .codeden-try
```

## Layout

```
apps/
  server/     Hono server: security, SQLite event log + projections (Drizzle), UI WebSocket,
              orchestration, MCP tools, automations, factory, GitHub sync
  runner/     Runner process: provider sessions, event journal, terminals, browser, git
  web/        React 19 + Vite SPA (Tailwind v4, shadcn/ui, TanStack Router + Query, Zustand)
  cli/        The published `codeharden` package: CLI entry, bundles server + runner + web
packages/
  contracts/  zod schemas for everything that crosses a boundary
  providers/  Provider adapters (Claude, Codex, Fake, Replay) and image engines
docs/         User docs and DESIGN.md
changes/      Changelog fragments for the next release (see changes/README.md)
```

Package READMEs go deeper: [apps/server](apps/server/README.md), [packages/providers](packages/providers/README.md), [the runner's browser engine](apps/runner/src/browser/README.md).

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install the workspace |
| `pnpm dev` | Server on 127.0.0.1:4318 (Fake provider on) + Vite on http://localhost:5173 |
| `pnpm build` | Build the web app, then bundle `apps/cli/dist` |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` | Biome check |
| `pnpm format` | Biome fix + format |
| `pnpm test` | Vitest, the fast suites (what CI and the release run) |
| `pnpm test:slow` | The real-browser and real-process suites (Chromium, terminals, detached runners); not in CI |
| `pnpm e2e` | Build the web app, then Playwright against a real server + runner with an isolated home and the Fake provider; not in CI |
| `pnpm db:generate` | Generate a Drizzle migration after editing `apps/server/src/db/schema-*.ts`. If `main` gained a migration since you generated yours, delete your migration's folder after rebasing and generate it again, so the migrations stay one chain (`pnpm test` checks it) |

Before you push: **`pnpm typecheck && pnpm lint`** must pass, and so must the tests of what you changed (`pnpm exec vitest run --project <name>`). CI runs typecheck and lint in one Linux job, runs all of `pnpm test` for pull requests into `harden` that are ready for review (not for drafts), then builds, packs the npm tarball, installs it, runs `codeharden doctor` and starts it to check the API and the web UI are served. Pull requests that only touch documentation skip it. The **CI result** check sums it up. The slow suites, the Playwright e2e suite and the desktop smoke test aren't part of CI; run them when you work in those areas. The release workflow builds and checks the desktop installers on Windows, macOS and Linux.

## Conventions

- **Contracts first.** Any new message, event, entity or setting goes into `packages/contracts` (with JSDoc and a round-trip test) before it is used. Validate at boundaries with the shared schemas.
- **Plain TypeScript**, strict, ESM. No Effect and no clever abstractions.
- **Small modules.** Keep files under roughly 400 lines; split by concern.
- **Honest capabilities.** UI and orchestration read `ProviderCapabilities`; never branch on a provider id.
- **Events are append-only.** Projections are written in the same transaction as their event (`apps/server/src/events/`), so they can be rebuilt from the log.
- **Security.** Server and runner bind 127.0.0.1 only; every request needs the install token; never log or persist tokens, and never write them into transcripts.
- **Describe CodeDen on its own terms.** Don't mention other harnesses or products as inspiration or comparison anywhere: code, comments, docs or commits.
- **Generated files** (don't edit by hand): `apps/server/drizzle/` (drizzle-kit migrations), `apps/web/src/components/ui/` (shadcn; add components with `pnpm dlx shadcn@latest add <name>` from `apps/web`), and `packages/providers/src/codex/protocol/` (generated from the installed Codex).

### Commits and pull requests

- [Conventional commits](https://www.conventionalcommits.org/): `feat(server): ...`, `fix(runner): ...`, `docs: ...`, `chore: ...`. One logical change per commit.
- Keep pull requests focused, describe the behaviour change and how you tested it, and include screenshots for UI changes.
- **Changelog notes go in `changes/`, not in `CHANGELOG.md`.** A user-facing change adds its own file, `changes/<issue>-<slug>.md`, with front matter naming its section and one or more bullets:

  ```md
  ---
  section: fixed
  ---

  - **A bold lead.** What changed, written for people who use CodeDen.
  ```

  The section is one of `added`, `changed`, `deprecated`, `removed`, `fixed` or `security`. Every pull request writes its own file, so they never conflict on the changelog; the release assembles them. Docs-only and internal changes need no note. `pnpm test` checks the format; see [changes/README.md](changes/README.md).

## Testing

- **Keep tests lean.** Add a Vitest unit test (in the package's `test/` folder) when logic is easy to get wrong and costly when wrong: security checks, contracts, migrations, parsers, anything that can lose data. Skip end-to-end and real-browser tests for features unless they're asked for, and keep `pnpm test` fast and deterministic.
- **Use the Fake provider** (scripted and deterministic) or the **Replay** provider (recorded sessions) in tests, never live agent turns.
- Server tests run the runner without the real Claude and Codex adapters (`CODEDEN_BUILTIN_PROVIDERS=0`), so they never reach a live agent. GitHub is faked behind Octokit's `fetch` (`apps/server/test/support/fake-github.ts`).
- `pnpm test:slow` runs the suites that drive real processes (Chromium, terminals, detached runners), one file at a time so a loaded machine can't starve their waits.
- **End to end:** `pnpm e2e`. On the first run install the browser with `pnpm --filter @codeden/web exec playwright install chromium`.

### Live tests (opt in, small real cost)

Live tests use your real Claude Code, Codex and OpenCode logins, so they are skipped unless `CODEDEN_LIVE=1` is set. The `test:live` scripts set it for you:

```sh
pnpm --filter @codeden/providers test:live    # adapter smoke tests against the installed CLIs
pnpm --filter @codeden/server test:live       # real sessions through server + runner + MCP
```

Some suites need an extra switch because they create real GitHub repositories:

```sh
CODEDEN_LIVE=1 CODEDEN_LIVE_GITHUB=1  pnpm --filter @codeden/server test:live -- github
CODEDEN_LIVE=1 CODEDEN_LIVE_FACTORY=1 pnpm --filter @codeden/server test:live -- factory
```

They create a private `codeden-sandbox-*` / `codeden-factory-sandbox-*` repository and delete it afterwards when your `gh` token has the `delete_repo` scope. `CODEDEN_LIVE_CLAUDE_MODEL` and `CODEDEN_LIVE_CODEX_MODEL` choose the models (Claude defaults to `haiku`).

To re-record the Replay fixtures or regenerate the Codex protocol types, see [packages/providers/README.md](packages/providers/README.md).

## Releasing (maintainers)

A CodeHarden release is one commit on `harden`, `release: <version> (upstream <sha>)`, tagged `v<version>`, where the version is the release time in America/New_York (`YYYY.MMDD.HHMM`). `scripts/harden/release.sh` writes `VERSION`, the new entry in [CODEHARDEN-CHANGELOG.md](CODEHARDEN-CHANGELOG.md) and `state/upstream-base`, commits and tags (`--dry-run` shows it first, `--push` pushes both). The "Upstream sync merge" workflow runs it after merging a sync. It asks GitHub about what was merged since the last release, and refuses when upstream commits among it were merged before their 48-hour cooldown was over, unless the owner waived it ([docs/codeharden-sync-cooldown.md](docs/codeharden-sync-cooldown.md)). Publishing to npm (`codeharden`) is done by hand by the owner with `scripts/harden/publish.sh`; see [docs/codeharden-npm-release.md](docs/codeharden-npm-release.md). Upstream's Release workflow is disabled here, and the app's own version stays upstream's.

## Reporting security issues

Please don't open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
