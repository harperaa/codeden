#!/usr/bin/env bash
# The whole fast suite (`pnpm test`) on this machine, for when you choose to run it: a manual
# command. Nothing calls it: not the pre-push hook (scripts/harden/push-checks.sh runs
# typecheck and lint only) and not a pull request, whose tests run in CI (see "Checks before a
# push and in CI" in AGENTS.md). It takes minutes and keeps the machine busy; for work in
# progress, run the tests of the packages you touched instead.
#
# A pass is remembered for the exact tree that was tested, so asking again for that commit
# doesn't run the tests again.
#
#   scripts/harden/local-checks.sh           test the checked-out commit and remember a pass
#   scripts/harden/local-checks.sh --status  say whether this commit's tree has passed
set -euo pipefail

label="local checks"
# shellcheck source=scripts/harden/checks-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/checks-env.sh"

passed_file="$(git rev-parse --git-common-dir)/harden-tests-passed"
tree=$(git rev-parse 'HEAD^{tree}')

has_passed() { [ -f "$passed_file" ] && grep -qx "$tree" "$passed_file"; }

if [ "${1:-}" = "--status" ]; then
  if has_passed; then echo "local checks: this commit's tree has passed the full suite here."; exit 0; fi
  echo "local checks: the full suite has not been run here on this commit's tree (optional; CI runs it on the pull request)."; exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "local checks: tracked files have changes that aren't committed. The result is remembered per commit: commit them first." >&2
  exit 1
fi
if has_passed; then
  echo "local checks: this commit's tree already passed the full suite here."
  exit 0
fi

echo "local checks: running the full suite (pnpm test) on $(git rev-parse --short HEAD), by request ..."
if ! pnpm test; then
  echo >&2
  echo "local checks: the tests FAILED. This blocks nothing by itself: a push runs typecheck and lint only, and CI runs the tests on the pull request." >&2
  exit 1
fi
if [ "$(git rev-parse 'HEAD^{tree}')" != "$tree" ] || [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "local checks: the checkout changed while the tests ran; run them again." >&2
  exit 1
fi
echo "$tree" >> "$passed_file"
echo "local checks: the full suite passed."
