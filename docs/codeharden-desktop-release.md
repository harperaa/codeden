# Publishing CodeHarden's desktop installers

The desktop app's installers are built on GitHub, by the "Desktop installers" workflow (`.github/workflows/harden-desktop.yml`), for the releases you choose, and attached to that release on GitHub. An installed app looks for updates in the latest published release of this repository, so a release only needs installers when you want desktop users to get it. Nothing here touches npm ([Publishing to npm](codeharden-npm-release.md) is separate), and the workflow never starts by itself. A run that signs and publishes waits for your approval on GitHub first ([Approval before signing and publishing](#approval-before-signing-and-publishing)); a rehearsal never does.

## Every time

1. **Have a release tag.** A CodeHarden release is a tag `v<VERSION>` on `harden` (`scripts/harden/release.sh --push`, or the one the sync workflow made). The tag must contain this workflow's packaging: `v2026.1122.2240` and earlier build an app that is still named CodeDen, and the workflow refuses them.

2. **Rehearse.** On GitHub: **Actions › Desktop installers › Run workflow**, on the branch `harden`, with the tag and **dry-run** ticked (the default). Or from a terminal:

   ```sh
   gh workflow run harden-desktop.yml --repo harperaa/codeharden --ref harden -f tag=v2026.0105.0518 -f dry-run=true
   gh run watch --repo harperaa/codeharden
   ```

   It builds on Windows, macOS and Linux, checks that the files carry the release's version, checks the macOS apps' signatures and that they start, and keeps the installers as artifacts of the run for 14 days (`desktop-windows-latest`, `desktop-macos-latest`, `desktop-ubuntu-latest`). No release is created or changed. A dry run is always **unsigned**: it reads no signing secret and nobody is asked to approve it. Its first job, "Check the tag", also says whether the approval is set up: a notice that the environment `release` requires a review, or a warning that names what a real run would stop on.

3. **Publish.** Run it again for the same tag with **dry-run** off (`-f dry-run=false`), on `harden`. The run stops and waits for you: open its page, press **Review deployments**, tick `release` and press **Approve and deploy** ([what approving looks like](#approving-a-run)). Then the macOS and Windows installers are built and signed. After all three systems have built, one job creates the GitHub release as a draft (if the tag has none; its notes are the version's entry in `CODEHARDEN-CHANGELOG.md`), attaches every file, the update files last, and only then publishes the release and marks it latest.

4. **Check it.** The release page lists:

   | System | Files |
   |---|---|
   | Windows | `CodeHarden-Setup-<version>.exe`, its `.blockmap`, `latest.yml` |
   | macOS | `CodeHarden-<version>-arm64.dmg`, `CodeHarden-<version>-x64.dmg`, the two `.zip` files the updater downloads, their `.blockmap` files, `latest-mac.yml` |
   | Linux | `CodeHarden-<version>-x86_64.AppImage`, `codeharden_<version>_amd64.deb`, `latest-linux.yml` |

   `<version>` is the npm form of the release (`2026.105.518` for the tag `v2026.0105.0518`): leading zeros are stripped, because the app's version must be valid semver.

**If a system fails, or you reject the review,** nothing is attached: the publishing job only runs when all three built. Fix the cause and run it again. **If the publishing job itself fails partway,** the release is left as it was (a draft when the workflow created it), and running the workflow again for the same tag replaces the files and finishes the job. A draft is invisible to installed apps.

## Approval before signing and publishing

A real run (dry-run off) signs nothing and publishes nothing until a person has approved that run on GitHub. A dry run is not affected: it uses no environment, needs no approval and is given no secret.

**How it works.** The signing secrets are not repository secrets any more. They are kept in a GitHub *environment* called `release`, which has **Required reviewers**. A real run's macOS and Windows jobs name that environment, so GitHub does not start them, and does not let them read the environment's secrets, until a reviewer has approved the run. The job that attaches and publishes needs both of those jobs, so it can't start before the approval either, and it never starts when the review is rejected.

**One approval per real run.** The macOS job and the Windows job wait at the same moment for the same environment, and GitHub's review is given per environment for the run, so one review releases both. The publishing job names no environment on purpose: as a third job in the environment, starting an hour after the first two, it would ask again. Linux has nothing to sign; its build needs no approval and starts at once, but its files stay artifacts of the run until the publishing job runs. Expect a re-run of a failed signing job to ask again: it is a new job in the environment.

**Why the secrets move.** A repository secret can be used by any workflow on any branch: anyone who may push a branch can write a workflow that reads it, with no approval. An environment's secret can only be read by a job that names the environment, started from a branch the environment allows, after the review. While a repository-level copy of a signing secret exists, the approval does not protect that secret, which is why the last setup step deletes the copies.

### Set it up, once

You do these steps yourself, signed in to GitHub as the repository's owner. **No agent creates the environment, enters or reads a secret, or approves a run.** Keep the order: it is the one in which no real run can publish an unsigned app in between.

1. **Create the environment.** **github.com/harperaa/codeharden › Settings › Environments › New environment**, name it `release` (exactly; the workflow names it), **Configure environment**. If `release` is already in the list, open it instead.

2. **Required reviewers.** Tick **Required reviewers**, add yourself, and leave **Prevent self-review** off: with it on, the person who started a run can't approve it, and when you are the only reviewer nobody could. (Up to six people or teams can be listed; one approval is enough.) Untick **Allow administrators to bypass configured protection rules**, so that there is no second way past the review. Press **Save protection rules**.

3. **Only `harden` may use it.** Under **Deployment branches and tags** choose **Selected branches and tags**, press **Add deployment branch or tag rule**, ref type **Branch**, name pattern `harden`, **Add rule**. GitHub matches this rule against the branch a run was *started on* (the branch chosen in "Run workflow"), not against the tag given as input, so `harden` is the right rule and a tag rule is not needed. It is what keeps a workflow file on some other branch from asking for the secrets: only the workflow as it is on `harden` can. Not "Protected branches only": that admits every protected branch, and every branch when none is protected. Add no second rule: the workflow refuses a real run unless this one rule, the branch `harden`, is the only one.

4. **Add the signing secrets to the environment.** On the same page, **Environment secrets › Add environment secret**, once per secret: the five macOS ones (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) and, if you sign for Windows, `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. GitHub never shows a saved secret again, so they can't be copied over from the repository's: enter each value again ([Signing with an Apple Developer ID](#signing-with-an-apple-developer-id) says what each one is; export the `.p12` from your keychain again, with a new password if you like, and make a new app-specific password if you no longer have the old one).

5. **Have the workflow that names the environment on `harden`:** merge the change that added the approval (once; it is there for good). Until then a real run works as before, from the repository-level secrets.

6. **Rehearse.** Run the workflow for a release tag with **dry-run** on (this also shows that GitHub accepts the new workflow file). Its "Check the tag" job says: *The environment "release" requires a review … and only harden may use it: a real run waits for an approval before it signs or publishes.* A warning there instead names what is missing; fix it and run the dry run again.

7. **Delete the repository-level copies.** **Settings › Secrets and variables › Actions › Repository secrets**: delete the same names there. Only now are the secrets behind the approval. (Don't delete them before step 5: the old workflow would then build an unsigned app in a real run and publish it.)

**If a step was skipped,** a real run stops instead of publishing something unsigned or unapproved:

| What is wrong | What a real run does |
|---|---|
| The environment `release` doesn't exist | Stops in its first job, before anything is built. (GitHub would otherwise create the environment the moment a job names it, with no reviewers and no secrets, and the run would go through unapproved.) |
| It has no required reviewers, or anything but the one branch `harden` may use it (no rule, "Protected branches only", a second rule, a pattern, a tag rule) | Stops in its first job, naming which. |
| The run was started on another branch than `harden` | Stops in its first job. |
| The environment has no macOS signing secrets | Asks for the approval; then the macOS job stops in its first step, within seconds and before anything is checked out. Nothing is published. |
| Only some of the five macOS secrets are there | The macOS job stops before packaging and names the missing ones, as before. |

The first three are read from the environment's settings, which anyone who can read the repository can read. Whether the environment has its *secrets* can't be known before the approval: a workflow's token can't list an environment's secrets, so the first step of the approved job looks (it learns only whether they are set, never a value). That step can't tell an environment's secret from a repository-level one of the same name either; step 7 is what makes sure of that.

### Approving a run

After you start a real run, its page (**Actions › Desktop installers ›** the run) shows that `release` is waiting for review, and GitHub notifies the reviewers. Press **Review deployments**, tick `release`, add a comment if you like, and press **Approve and deploy**. **Reject** fails the run; nothing is signed or attached. A run nobody reviews fails by itself after 30 days.

Before you approve, look at what you are approving: the run's title names the tag and says "sign and publish", its page says who started it, and the "Check the tag" job's log names the commit.

**Who can approve:** the people (or members of the teams) listed as required reviewers, and nobody else once the administrators' bypass is off. One approval is enough.

**GitHub does not ask for a one-time code or a passkey at the moment you approve.** It relies on your signed-in session, and the passkey or two-factor step happened when that session signed in. So the approval is as strong as your sign-in: keep two-factor authentication (or a passkey) on the account, and don't stay signed in on a computer other people use. The same holds for anything else that holds your sign-in: GitHub's API accepts an approval from a token of a required reviewer, and the `gh` command on a computer where you are signed in holds such a token. An agent working in this repository never approves, rejects or bypasses a review, and never changes the environment.

### What it does not do

- **It gates this workflow and the signing identity, not GitHub releases as such.** Someone with write access to the repository can still create a release by hand and attach files to it. What they can't do without your approval is sign with your Developer ID, and a macOS app only replaces itself with one signed by the same developer.
- **An administrator can undo it.** Whoever administers the repository can change the environment's rules. With one owner that is you.
- **An approved run executes the tag's code with the secrets.** The packaging scripts and dependencies of the tag you name run in the signing jobs. The workflow only accepts a tag whose commit is part of `harden`, so it is code that reached `harden` the usual way, and it builds only the commit it checked (a tag moved while the run waits stops the run). The build jobs use no cache, so nothing an earlier run left behind ends up in a signed app. An *older* release tag is still older code, with the dependencies it had then: build the release you just made, not an old one, unless you mean to.
- **A signed build can't be rehearsed.** A dry run is unsigned, so the Developer ID signature, the notarization and Gatekeeper's verdict are first checked in the real run, before anything is attached: if that check fails, the release is untouched.

### Two repository variables

| Variable | Unset | Other values |
|---|---|---|
| `SIGNED_INSTALLERS` | `macos`: a real run must sign the macOS app, and stops when the environment has no macOS signing secrets | `macos windows` once you sign for Windows too; `windows`; `none` for a repository that publishes unsigned installers |
| `RELEASE_APPROVAL` | `required`: a real run stops unless the environment `release` exists, has required reviewers and admits the default branch only | `none`: publish without an approval; the environment's rules are not checked |

`RELEASE_APPROVAL=none` is for a fork that can't have reviewers: GitHub offers required reviewers for public repositories on every plan, and for private ones only on GitHub Enterprise. CodeHarden's own repository leaves both variables unset.

## Signing

The macOS app is signed with a Developer ID and notarized. There is no Windows certificate, so the Windows installer is unsigned: it works, and the system warns once. A dry run's installers are unsigned on every system.

| System | Without a certificate | With one |
|---|---|---|
| Windows | SmartScreen shows "Windows protected your PC"; the user chooses **More info**, then **Run anyway**. The app updates itself. | A code-signing certificate (`.pfx`) names the publisher in the prompt. SmartScreen still warns until the certificate has a reputation; an EV certificate has one from the start. |
| macOS | The app is signed ad hoc and not notarized. macOS says it can't verify the developer; the user allows it once under **System Settings › Privacy & Security › Open Anyway**. **It can't update itself**: macOS only lets an app with a Developer ID replace itself, so new versions are downloaded from the release page and dragged over the old one. Settings › About says so. | A Developer ID Application certificate and notarization (an Apple Developer account) make it open without a warning and update itself. |
| Linux | AppImage and `.deb` are not signed; nothing warns. The AppImage updates itself, the `.deb` through the downloaded package. | Nothing to change. |

[The desktop app](desktop.md#unsigned-builds) has the steps a user follows.

In a real run each system's build is given its own secrets, from the environment `release`, and nothing else. A dry run is given none:

| System | Secrets | Notes |
|---|---|---|
| macOS | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | All five or none. With only some of them the macOS job stops and names the missing ones. With none of them a real run stops too, unless `SIGNED_INSTALLERS` says macOS is published unsigned. |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Both or neither. Windows never receives `CSC_LINK`: electron-builder would fall back to it and try to sign the installer with the Apple certificate. |
| Linux | none | |

## Signing with an Apple Developer ID

You do these steps yourself, signed in to your Apple account and to GitHub. **The secrets are entered by you in the settings of the environment `release`** ([Approval before signing and publishing](#approval-before-signing-and-publishing) sets it up). **No agent ever sees, creates or handles them**, and they are never printed by the workflow.

1. **Create the certificate.** On your Mac open **Keychain Access › Certificate Assistant › Request a Certificate From a Certificate Authority**, enter your email and name, and choose **Saved to disk**. At [developer.apple.com/account](https://developer.apple.com/account) go to **Certificates, IDs & Profiles › Certificates › +**, choose **Developer ID Application** (not "Developer ID Installer", and not "Apple Development"), upload the request file, download the certificate and double-click it so it lands in your login keychain. Only the account holder of the developer team can create this kind.

2. **Export it as a `.p12`.** In Keychain Access, under **My Certificates**, find "Developer ID Application: <your name> (<team id>)". It must show a private key under it when expanded. Right-click it, **Export**, file format **Personal Information Exchange (.p12)**, and set a strong password you will use nowhere else.

3. **Turn it into text**, straight to the clipboard, so the file's content never appears in a terminal:

   ```sh
   base64 -i DeveloperID.p12 | pbcopy
   ```

4. **Make an app-specific password** for notarization: [account.apple.com](https://account.apple.com) › **Sign-In and Security › App-Specific Passwords › +**. It looks like `abcd-efgh-ijkl-mnop`. This is not your Apple account password.

5. **Add the five secrets** at **github.com/harperaa/codeharden › Settings › Environments › `release` › Environment secrets › Add environment secret** (not as repository secrets: those can be read without an approval):

   | Secret | Value |
   |---|---|
   | `CSC_LINK` | The base64 text from step 3 |
   | `CSC_KEY_PASSWORD` | The password you set when exporting the `.p12` (step 2) |
   | `APPLE_ID` | The email address of your Apple developer account |
   | `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from step 4 |
   | `APPLE_TEAM_ID` | The ten-character team id: developer.apple.com/account › **Membership details**, or the part in brackets in the certificate's name |

   Then delete the `.p12` file from your disk (the certificate stays in your keychain), and clear the clipboard by copying something else.

6. **Run the workflow** for a release tag made after the secrets were added (cut a new release first: the workflow runs the signature check of the tag it builds, and `v2026.1122.2302` has the older, lenient one), with **dry-run** on first: that checks the build, unsigned. Then run it with **dry-run** off and approve it. The macOS job's log says "signing with the Developer ID certificate and notarizing". Apple's notarization is waited for inside that step and can be slow, most of all for an app Apple has not seen before: the first signed build here spent 46 minutes in it, so the signing job for macOS is allowed two hours. The signature check is then strict: it fails unless each app is signed with your Developer ID, has Apple's notarization ticket stapled to it, and is accepted by Gatekeeper as a downloaded app, and nothing is attached to the release unless it passes.

**What changes for people using the app:**

- It opens on first launch without the "can't verify the developer" warning and without **Open Anyway**.
- It updates itself, like the Windows and Linux apps, and **Settings › About** no longer says that this macOS build can't update itself. The app decides this by looking at its own signature each time it starts (`macSigned` in `apps/desktop/src/main/system.ts`: a "Developer ID Application" authority), so nothing else needs to be switched on.
- **Someone on an earlier, unsigned build installs the signed one by hand, once:** an unsigned app can't replace itself, so they download the new `.dmg` from the release page and drag it over the old app. From then on it updates itself. Their data is untouched.

**Keep in mind:** a Developer ID certificate is valid for five years, and apps signed with it keep working after it expires, but new builds need a new one. If the secrets are ever exposed, revoke the certificate at developer.apple.com and the app-specific password at account.apple.com, then make new ones.

### Signing the Windows installer

A Windows code-signing certificate is a separate purchase from a certificate authority. With a `.pfx` file: base64 it the same way, add `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` as secrets of the environment `release`, and set the repository variable `SIGNED_INSTALLERS` to `macos windows`, so that a real run can't publish an unsigned installer again. Certificates that live on a hardware token or in a cloud signing service (most new ones do) can't be exported to a `.pfx` and need a change to the workflow first.

## Good to know

- **Manual only.** The workflow has no `push` or schedule trigger. Upstream's Release workflow stays disabled: it reacts to every `v*.*.*` tag, which CodeHarden's tags match, and publishes to npm.
- **What may write.** The build jobs run the repository's code with a read-only token. One job has `contents: write`; it runs no code from the repository and only moves the built files onto the release.
- **What holds a secret.** Only a real run's macOS and Windows jobs, after the approval. The job that checks the tag, a dry run's builds, the Linux build and the publishing job hold none.
- **Installed apps** read the latest *published* release. A release with no installers is "up to date" to them, quietly, so a CodeHarden release without desktop installers is fine.
- **Sync pull requests.** The workflow file, `apps/desktop/scripts/` and `apps/desktop/electron-builder.config.mjs` are protected paths of the "Upstream sync merge" workflow: an upstream change to how the app is packaged is merged by a person, not by the workflow, once its 48 hours are over ([The 48-hour cooldown](codeharden-sync-cooldown.md)). The two cooldown workflows are protected the same way.
- **A fork's own app.** In a fork the installers are the fork's: named after its `PACKAGE_NAME` repository variable (and the optional `PRODUCT_NAME`, `APP_ID`, `DEFAULT_PORT`), updating from the fork's own releases. The workflow refuses to run in another repository until `PACKAGE_NAME` is set. A fork's real run needs its own `release` environment, or the two variables that say it publishes unsigned and unapproved ([Two repository variables](#two-repository-variables)).
- **Build one yourself:** `pnpm desktop:dist` makes the installers for the system you are on, in `apps/desktop/release/`.
- **Installers are a release, also on your own computer.** Every packaging run that makes installers (`pnpm desktop:dist`, and this workflow with or without `dry-run`) sets `HARDEN_RELEASE_PACK=1` for itself (`apps/desktop/scripts/package.mjs`; the rule is in `scripts/harden/channel-define.mjs`). In a checkout whose `origin` is not CodeHarden's repository it then stops until `PACKAGE_NAME` is set (and `RELEASE_REPOSITORY`, when the checkout has no GitHub `origin`), instead of packing the fork's app with CodeHarden's update channel. A dry run is strict too, because it rehearses the release. The unpacked app (`pnpm desktop:build`), `pnpm desktop:dev` and the tests only warn. The check reads the variables at packaging time: build and package with the same ones, as `pnpm desktop:dist` and the workflow do.
