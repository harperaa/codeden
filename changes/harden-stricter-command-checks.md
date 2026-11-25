---
section: changed
---

- **The approval check asks in a few more cases.** Stricter handling of variables such as `HOME` and `TMPDIR` that a command line sets (also with `read`, `unset` or `+=`) and then uses, of `cp` and `mv` option clusters and backup suffixes, of `$'…'` quoting in a script handed to `sh -c`, and of `cd /d` where cmd is not the shell. Commands that stay in the worktree run as before.
- **Long and deeply nested commands are checked faster, or not at all.** String literals, `mktemp` templates, braced variables and a few two-part patterns in a command are now read in one pass, so a very long command line no longer holds up the other sessions while it is checked. A command longer than 32,768 characters, or one that nests scripts so deep or so often that it can't be read in reasonable time, isn't read: it asks at every permission level, and is refused in a read-only session.
