---
name: npm-release
description: Cut a CodeHarden release and prepare its npm publish (the `codeharden` package). Use when asked to release, publish or pack CodeHarden, to rehearse a release, or to check what is published.
---

# Release CodeHarden and prepare the npm publish

The steps for a person are in `docs/codeharden-npm-release.md`; read it first. The package name below is CodeHarden's; in a fork it is the repository variable `PACKAGE_NAME`, which the scripts read themselves (they refuse outside `harperaa/codeharden` until it is set). Two scripts do the work: `scripts/harden/release.sh` (version, changelog, commit, tag) and `scripts/harden/publish.sh` (build, pack, check, publish). Never call `npm publish` directly, and never edit `apps/cli/package.json` to rename the package: the rename happens in a staging copy at pack time.

## Rules

- **Publish only when the owner asks for it in this conversation**, for the release they name. A published version can never be replaced, so an earlier go-ahead, a note or a memory is not enough. Without that ask, the only publish command you run is `scripts/harden/publish.sh --dry-run`.
- **The owner approves, not you.** npm prints a URL and waits, for a sign-in and for a publish alike; you pass it to them and open it for them, and they approve in their own browser with their second factor. Never type, ask for, print or store an npm password, token or one-time code, and never put a sign-in or approval URL, or its id, in anything public (a commit, an issue, a pull request, a comment). The URL goes to the owner in the conversation and nowhere else.
- **You may sign in to npm for the owner only as part of a publish they asked for in this conversation**, for the release they named, and only when `npm whoami --registry https://registry.npmjs.org` shows nobody (or that publish failed for lack of a sign-in). Not at any other time, and never "to be ready".
  - **The web flow only:** `node scripts/harden/npm-release.mjs login` (it runs `npm login --auth-type=web` against the named registry), with the pass-the-URL technique of step 5. Never with a password, token or one-time code on a command line, in the environment or typed into a prompt. If npm asks for a username, password or code in the terminal instead of printing a URL, stop the command and tell the owner to run `npm login` themselves.
  - **Say who it is before publishing.** After signing in, run `npm whoami --registry https://registry.npmjs.org` and tell the owner which account it is. If it is not an account that can publish this package, stop.
  - **It is the owner's own npm session on their machine.** Say in your report that npm is now signed in on this computer and how to sign out (`npm logout`), so it is their choice whether it stays.
- **`E404` on publish is about the sign-in, almost always.** See "If the publish fails with E404" below; don't report it as a missing or broken package.
- A dry run and `node scripts/harden/npm-release.mjs status` contact the real registry (`npm view`, `npm whoami`) and send only the package name. Say so when you report them.
- Don't enable or dispatch the Release workflow (`.github/workflows/release.yml`); it stays disabled.
- Cutting a release pushes a commit and a tag to `harden`. Do it only when the owner asked for a release in this conversation. Never force-push and never move or delete a tag.
- **A release refused by the cooldown stays refused.** Before every release `release.sh` asks GitHub about what was merged since the last one: whether the pull request that brought upstream commits in had waited its 48 hours when it was merged, and whether a squashed or rebased pull request carried any (`docs/codeharden-sync-cooldown.md`). It needs `gh` on PATH, signed in, for every release; put it there the way you put `node` there, with a link in a folder of its own. Run it as it is: no `--upstream-ref`, and none of `UPSTREAM_URL`, `SYNC_COOLDOWN_NOW`, `SYNC_COOLDOWN_REPO` or `SYNC_WAIVER_APPROVERS` in its environment. When it refuses ("release: refused. ..."), or says GitHub could not be asked and a retry doesn't change that, stop and report its message as it is: which sync, from when it would have been allowed, and that only the owner can waive it. Don't write the release commit or tag by hand, don't change the scripts or the files a release writes (`VERSION`, `state/upstream-base`), don't publish another tag instead, and never start, approve or work around a waiver; the owner runs the "Waive sync cooldown" workflow, or asks you in this conversation to start it for them and approves it themselves. A waived release says "Sync cooldown waived by the owner" and carries that line in its changelog entry: include it in your report.

## Steps

1. `node scripts/harden/npm-release.mjs status`: the version in `VERSION`, its npm form and tag, who is signed in, what is published. Stop if this version is already published.
2. If the changes to ship aren't in a release yet, cut one on a clean, up-to-date `harden`: `scripts/harden/release.sh --dry-run`, show the owner the version and changelog entry it prints, then `scripts/harden/release.sh --push`. The dry run also prints the cooldown's verdict for each sync in the release and exits with an error when the real run would refuse: then stop there (the rule above).
3. Get a clean checkout of the tag: `git fetch origin --tags`, then `git checkout v<VERSION>`, or a scratch worktree (`git worktree add --detach <dir> v<VERSION>`).
4. `scripts/harden/publish.sh --dry-run` there. Report the name, version, `bin`, file count and what npm says it would publish, or the problems it lists.
5. **If npm is signed out and the owner asked you for this publish, sign in** (the rule above; otherwise skip this step). npm only waits for the browser when it has a terminal, so run the command under a pseudo-terminal, in the background, with its output in a log file outside the repository:

   ```sh
   script -q <log> node scripts/harden/npm-release.mjs login
   ```

   Wait for the URL npm prints in the log (`Login at:`, then `https://www.npmjs.com/login?next=/login/cli/...`), pass it to the owner and open it for them (`open <url>` on macOS), and tell them npm is waiting for their approval in the browser. npm also offers to open the browser on ENTER; you don't answer it, the command finishes by itself once they approve. Wait for it to exit, then delete the log. If the log shows `Username:` or `Password:` instead of a URL, stop the command: the owner runs `npm login` themselves. Then `npm whoami --registry https://registry.npmjs.org`: tell the owner the account, and stop if it can't publish this package.
6. **If the owner asked you to publish**, publish with the same technique, from the same checkout:

   ```sh
   script -q <log> node scripts/harden/npm-release.mjs publish --confirm <npm version>
   ```

   Wait for `https://www.npmjs.com/auth/cli/...` in the log, pass it to the owner, open it for them and tell them npm is waiting for their approval. Then wait for the command to exit and delete the log. Without a terminal npm stops with `EOTP` and publishes nothing.

   **Otherwise** hand them the command to run in their own terminal on that tag: `scripts/harden/publish.sh`.
7. **Verify from the registry, not from npm's output:** `npm view codeharden versions dist-tags`, and `npx codeharden@<npm version> --version` in an empty scratch folder. If the registry shows only a `0.0.0-stage` placeholder, the version is staged: the owner approves it on npmjs.com under account settings > Staged Packages. Don't report the release as published until the registry lists the version.
8. Remove the scratch worktree, or `git checkout harden`. Check that no log file is left. If you signed in, say so in your report: npm is signed in on this computer as `<account>`, and `npm logout` signs it out.

## If the publish fails with E404

`npm error code E404` with `404 Not Found - PUT https://registry.npmjs.org/<package>` (sometimes "is not in this registry", or "could not be found or you do not have permission to access it") on `npm publish` almost always means npm is not signed in or the sign-in expired: the registry answers 404, not 401, to a publish it can't authorise. It also happens when the signed-in account has no publish rights on the package. It does not mean the version or the package is broken. Nothing was published, and the same version can be published again after signing in. (With no sign-in stored at all, npm stops by itself with `ENEEDAUTH`, "requires you to be logged in": the same fix.)

1. `npm whoami --registry https://registry.npmjs.org` (or `node scripts/harden/npm-release.mjs status`). The script does this itself when a publish fails and says which case it is.
2. **Nobody signed in:** sign in as in step 5, then publish again (step 6).
3. **Somebody signed in and still 404:** the wrong account, or one without publish rights on the package. Stop and report the account name; don't sign in again as someone else.

Check the registry before publishing again (`npm view codeharden versions`): if the version is listed, it is published.

## If something is wrong after publishing

Don't unpublish. Tell the user; the fix is a newer release, and `npm deprecate codeharden@<version> "<reason>"` for the bad one, which is also theirs to decide.
