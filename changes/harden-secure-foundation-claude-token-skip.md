---
section: changed
---

- **Secure Foundation takes the template's "Skip for now" for the Claude review token.** The current template's `/deploy-to-dev` recommends skipping `CLAUDE_CODE_OAUTH_TOKEN` during the deploy and adding it later from your own terminal. With that version the setup session now follows the file as written: it lists the repository's secrets by name, takes "Skip for now" when the token is missing, and goes on. It never runs `claude setup-token` and never stores the token. With that version the install's CI token step also runs as written: it waits until the repository exists and creates nothing before then. The last message and the project's Secure Foundation setup card use the template's wording. Run `claude setup-token` in a regular terminal window, not inside a Claude Code session, then `gh secret set` and paste the token at its hidden prompt. Until the secret is set, the template's Claude review jobs show as skipped, which means no review ran.
