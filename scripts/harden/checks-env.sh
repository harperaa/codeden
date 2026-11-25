# Sourced by push-checks.sh and local-checks.sh, never run: the environment both need before
# they start pnpm. It leaves the shell in the repository's top folder, with `label` (the
# caller's name for its messages) used in what it prints.

# Inside a hook git exports its own variables (GIT_DIR, GIT_INDEX_FILE, ...). They must never
# reach the checks: tests create repositories of their own, and with these set their git
# commands would act on this repository instead. Drop them; git finds this repository from the
# folder again.
top=$(git rev-parse --show-toplevel)
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)
cd "$top"

# Node and pnpm, also from a shell whose PATH doesn't have them. Only those two programs are
# linked into a private folder, so nothing else that lives beside them joins the PATH.
if ! command -v pnpm > /dev/null 2>&1 || ! command -v node > /dev/null 2>&1; then
  # An absolute path: pnpm runs each package's script in that package's folder.
  bin="$(cd "$(git rev-parse --git-common-dir)" && pwd)/harden-hook-bin"
  mkdir -p "$bin"
  for dir in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin "$HOME/Library/pnpm" "$HOME/.local/share/pnpm"; do
    for tool in node pnpm; do
      if [ ! -e "$bin/$tool" ] && [ -x "$dir/$tool" ]; then ln -sf "$dir/$tool" "$bin/$tool"; fi
    done
  done
  PATH="$bin:$PATH"
  if ! command -v pnpm > /dev/null 2>&1 || ! command -v node > /dev/null 2>&1; then
    echo "${label}: node and pnpm were not found, so the checks can't run. Put them on PATH and try again." >&2
    exit 1
  fi
fi

# The checks use system tools (lsof, ps) that a trimmed PATH may not include.
PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
if env | grep -q '^GIT_DIR=\|^GIT_INDEX_FILE=\|^GIT_WORK_TREE='; then
  echo "${label}: git's own variables are still set; refusing to run anything with them." >&2
  exit 1
fi
