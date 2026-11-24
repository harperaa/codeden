---
section: changed
---

- **Secure Foundation follows the template's new GitHub Actions secrets step.** The template's `/deploy-to-dev` now has a Step 2.6. The setup session runs it: `DOPPLER_TOKEN` is stored by the template's own Step 2.6a once the repository exists (the install's CI token step defers until then, as the template's install expects), and the Claude review token question of Step 2.6b gets the template's recommended answer, "Skip for now". The session never runs `claude setup-token` and never stores that token. Its last message and the project's Secure Foundation setup card give the template's steps: in a regular terminal window, not a Claude Code session, run `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN` and paste the token at its hidden prompt. Until then the template's Claude review jobs show as skipped, which means no review ran.
