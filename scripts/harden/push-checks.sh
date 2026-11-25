#!/usr/bin/env bash
# The light checks the pre-push hook runs: `pnpm typecheck` and `pnpm lint`, nothing else. The
# tests are CI's job (on every pull request into the working branch; see "Checks before a push
# and in CI" in AGENTS.md), and this script never runs them.
#
# A pass is remembered for the exact tree that was checked, so pushing that commit again
# doesn't repeat the checks. With uncommitted changes in tracked files the checks still run,
# on the files as they are, but the pass is not remembered.
#
#   scripts/harden/push-checks.sh           check the checked-out commit and remember a pass
#   scripts/harden/push-checks.sh --status  say whether this commit's tree has passed
set -euo pipefail

label="push checks"
# shellcheck source=scripts/harden/checks-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/checks-env.sh"

passed_file="$(git rev-parse --git-common-dir)/harden-push-checks-passed"
tree=$(git rev-parse 'HEAD^{tree}')
has_passed() { [ -f "$passed_file" ] && grep -qx "$tree" "$passed_file"; }
is_dirty() { [ -n "$(git status --porcelain --untracked-files=no)" ]; }

if [ "${1:-}" = "--status" ]; then
  if has_passed; then echo "push checks: this commit's tree has passed typecheck and lint."; exit 0; fi
  echo "push checks: this commit's tree has not passed typecheck and lint yet."; exit 1
fi

dirty=false
if is_dirty; then
  dirty=true
  echo "push checks: tracked files have uncommitted changes; checking the files as they are."
elif has_passed; then
  echo "push checks: this commit's tree already passed typecheck and lint."
  exit 0
fi

for check in typecheck lint; do
  echo "push checks: pnpm ${check} on $(git rev-parse --short HEAD) ..."
  if ! pnpm "$check"; then
    echo >&2
    echo "push checks: pnpm ${check} FAILED. Nothing was pushed. Fix it and push again." >&2
    exit 1
  fi
done
if [ "$dirty" = "false" ] && [ "$(git rev-parse 'HEAD^{tree}')" = "$tree" ] && ! is_dirty; then
  echo "$tree" >> "$passed_file"
fi
echo "push checks: typecheck and lint passed."
