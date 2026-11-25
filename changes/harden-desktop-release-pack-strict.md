---
section: changed
---

- **A fork can't pack desktop installers under CodeHarden's name.** Building installers (`pnpm desktop:dist`, and the "Desktop installers" workflow, its dry run included) now stops in a checkout whose `origin` is not CodeHarden's repository until `PACKAGE_NAME` is set, the same way the npm release already did. Before, it printed a warning and built installers whose self-update pointed at the `codeharden` npm package. The message says what to set (`scripts/harden/setup-fork.sh` creates the repository variable). Development builds are as before: `pnpm desktop:build`, `pnpm desktop:dev` and the tests still only warn, and nothing changes in CodeHarden's own repository.
