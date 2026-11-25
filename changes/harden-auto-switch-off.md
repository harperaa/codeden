---
section: changed
---

- **Switching provider at a usage limit is off unless you turn it on.** CodeDen 0.7.9 adds a setting that moves the orchestrator and project managers to another signed-in provider by themselves when theirs reaches its usage limit, sends the failed message again there, and moves them back after the reset. Upstream ships it on. CodeHarden ships it off, because it changes which provider handles your work without asking: a turn that hits the limit fails like any other and waits for you. An install that never touched the setting gets "off" too. To turn it on: **Settings › Providers › Defaults per role › Switch provider automatically when a limit is hit**.
