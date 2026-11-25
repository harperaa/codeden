# Vision

CodeHarden is a hardened fork of CodeDen: the same tool for agentic coding, kept current with upstream, with security-first defaults, its own identity, and nothing reaching users that has not been reviewed.

- CodeHarden is the ultimate tool for Agentic Coding.
- Automations are easy to create and share, allowing users to easily switch on tasks that automatically run in the background
- CodeHarden supports agent skills, memory files, MCP servers and modern agentic coding tech
- CodeHarden does not waste space. Worktrees are automatically cleaned and removed once sessions are archived.
- CodeHarden supports advanced ADE features, like integrated browsers, computer use, dedicated agent computers and much more.

### What CodeHarden is
- It is CodeDen with everything CodeDen offers: all major providers, full traceability of what agents and subagents do and cost, a UI that works for "vibe coders" and experienced developers alike, and a path that scales with the user from single sessions to PMs, orchestrators, software factories and autonomous "dark factories".
- It stays close to upstream. Upstream arrives every day by merge, never by rebase or force-push, and the fork changes as few of upstream's lines as it can so merges stay easy.
- It is its own app. It has its own name, logo, app id, home folder, port, npm package and releases, so it installs and runs beside CodeDen and the two share nothing. It only ever updates from its own channel, never from upstream's.

### What it adds
- Secure Foundation: a new-project option that sets up a hardened Next.js, Clerk, Convex, Doppler and Vercel stack from the owner's Secure Vibe Coding OS, after one form that says exactly what will be created.
- A fork anyone can fork: three repository variables and one setup script give another team the same daily sync, review, release and publish machinery under their own names.

## Goals
- What should this project achieve in the next months?

## Target users
- Who uses it, and what do they need?

## Principles
- Small, well-tested changes
- Keep the public API stable

How it earns the word "hardened"
- Every upstream change is reviewed before it reaches users: dependencies and the lockfile, the risk classifier, permissions, tokens, network and auth, and CI and release workflows. Two agents from different providers review each sync, the second checks the first, and an approved change still waits 48 hours before it merges.
- A guard test fails when a merge brings upstream's own names back or drops one of the fork's changes, so a sync cannot quietly undo the hardening.
- Security findings stay private. They go to the owner, never into a pull request, an issue, a comment or a commit message. Weaknesses found in upstream's code are reported to upstream privately before a fix is made public here.
- Fixes to upstream's code go to upstream. Only fork-only functionality lives here alone.
- Releases are deliberate. A release is cut by script, npm is published by the owner's own approval for each release, nothing publishes from CI, and no token is stored anywhere. Desktop installers are built by a manual workflow and can be signed with the owner's certificates.
- People are told the truth about what was and was not verified, and nothing with a user name, a home path, an IP address or a token is ever posted.

## Out of scope
- sending credentials to any sites except for clerk, doppler, convex, and vercel, unless explicitly approved by owner.
- deleting or changing any files outside the project folder.

## Quality bar
- Every behaviour change comes with tests
- CI is green before merge

## Protected areas
Paths (globs in backticks) and topics that always need a human. The factory never merges
changes that touch them; they go to your inbox.
- `**/auth/**`
- `**/migrations/**`
- `.github/workflows/**`
- `LICENSE`
- payments
- licensing

## Your job
- Keep CodeHarden current with upstream and keep the differences small, guarded and documented.
- Stay informed about the security of agentic coding tools: supply-chain attacks on dependencies and workflows, prompt injection through repository and web content, what agents may do without asking, and how secrets are handled. Raise what you learn as concrete changes or as private findings.
- Stay informed about the tools and features of modern agentic development environments, software factories and dark factories, as upstream's vision asks, and judge each through the question this fork exists for: is it safe to give this to a user by default?
- When a choice is unclear, prefer the safer default, say what you chose, and make it easy to change.
