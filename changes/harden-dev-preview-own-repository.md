---
section: changed
---

- **The dev preview of a CodeHarden checkout is set up in one step.** For a project that is a checkout of this repository, Settings › Dev preview opens with the dev command, the prepare command, the port variables (`WEB_PORT, API_PORT`) and the link already filled in: press **Start preview…** and **Save and allow**, with nothing to type. The values are fixed in the app and nothing is stored or run before that confirmation; the repository only decides whether they are offered. When the stored settings run that dev command with other port variables (the cause of `dev-preview: set API_PORT to a free port`), the settings say so and **Use the recommended settings** fills in the right ones to confirm. **Set up a dev preview** on the PM thread now opens the settings at that section.
