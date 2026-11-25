---
section: changed
---

- **Docker sandboxes carry CodeHarden's own names.** The runner image is `codeharden-runner:<version>`, a session's container and volume are `codeharden-<id>` and `codeharden-<id>-data`, and their labels start with `codeharden.` (a fork gets its own word), so CodeHarden and CodeDen on one machine no longer build the sandbox image over each other's under one name. Sandboxes that already exist keep working under the name they have, and an image built earlier as `codeden-runner:<version>` is left in place: the first sandbox session after the update builds the new one.
