# Vision

CodeHarden is a hardened fork of CodeDen: the same tool for agentic coding, kept current with upstream, with security-first defaults, its own identity, and nothing reaching users that has not been reviewed.

- CodeHarden is the ultimate tool for Agentic Coding.
- It has support for all major providers and agentic coding features.
- It offers full traceability - like what subagents are doing, costs and much more.
- The UI is sleek and easy to navigate for "vibe coders" and experienced developers alike.
- It "scales with the user" - users can create single sessions themselves, use PMs, Orchestrators, scale up to software factories and atonomous "dark factories"
- Automations are easy to create and share, allowing users to easily switch on tasks that automatically run in the background
- CodeHarden supports agent skills, memory files, MCP servers and modern agentic coding tech
- CodeHarden does not waste space. Worktrees are automatically cleaned and removed once sessions are archived.
- CodeHarden supports advanced ADE features, like integrated browsers, computer use, dedicated agent computers and much more.
- Your job is to stay informed and up to date with the tools and features available in modern ADEs.
- Your job is to research the latest developments in software factories, dark factories and agentic coding tools to ensure CodeHarden is on the cutting edge.

## Goals
- What should this project achieve in the next months?

## Target users
- Who uses it, and what do they need?

## Principles
- Small, well-tested changes
- Keep the public API stable

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
