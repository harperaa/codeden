---
section: changed
---

- **A new project's scheduled automations no longer start at the same moment as every other project's.** Each scheduled automation of the starter set (Security audit, Test coverage gaps, Dependency updates, Stale PR follow-up) is created with the next free start time, in 10-minute steps from the template's: the first project keeps 03:00, the second gets 03:10, the third 03:20. Only the time of day moves; the days and the cadence stay the same. The free time is judged against the schedules your active projects have for that automation now, so a time you set by hand counts and an archived project's time is used again. Automations you already have keep their schedules, and they are created switched off as before.
