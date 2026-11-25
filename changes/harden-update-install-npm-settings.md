---
section: changed
---

- **The update install respects three more of your npm settings.** `npm_config_min_release_age`, `npm_config_before` and `npm_config_allow_git` set in the environment are passed on to the npm that installs an update, beside the registry, proxy and certificate settings. `npm_config_ignore_scripts` is not: the terminal's native module needs its install script, so an update installed without it would start and not work.
