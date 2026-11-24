---
section: changed
---

- **Secure Foundation keeps deploying when the template asks for the Claude token.** Newer versions of the template's `/deploy-to-dev` ask for a `CLAUDE_CODE_OAUTH_TOKEN` right after the repository exists. The setup session doesn't ask you and never handles the token: it checks, by name only, whether the repository has the secret, finishes the deploy, and its last message says how to add it in your own terminal (`claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo <owner>/<repo>`). It also follows whichever version of the template it installs, so the Doppler CI token is created exactly once.
