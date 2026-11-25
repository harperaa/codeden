// Scratch repositories and a stub `gh` for the fork script tests. Nothing here touches this
// checkout, GitHub or npm.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STUB_GH = fileURLToPath(new URL("./stub-gh.sh", import.meta.url));

export const BASE_ENV = {
  PATH: process.env.PATH,
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

export function sh(cwd, command, args, env = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...BASE_ENV, ...env } });
  return { code: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
}

/** A git repository in a new temporary folder, with `git(...)` and `commit(file, subject)`. */
export function repository(prefix, initArgs = ["--initial-branch=harden"]) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args) => {
    const result = sh(dir, "git", args);
    if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.err}`);
    return result.out;
  };
  const commit = (file, subject) => {
    writeFileSync(join(dir, file), `${subject}\n`);
    git("add", file);
    git("commit", "--quiet", "-m", subject);
    return git("rev-parse", "HEAD");
  };
  git("init", "--quiet", ...initArgs);
  return { dir, git, commit };
}

/**
 * A folder to put first on PATH: the stub `gh`, and a `git` that writes each call to
 * `<state>/git-log` before running the real one. `state` holds the stub repository's settings.
 *
 * So that nothing reaches the network, GIT_STUB_REMOTES names stand-ins for remotes: pairs
 * `<remote name or URL>=<local path>`, separated by spaces. The wrapper swaps them in for
 * `ls-remote`, `fetch` and `push`; everything else (the remote's own URL, which says which
 * repository this is) stays as it is.
 */
export function stubTools(settings = {}) {
  const bin = mkdtempSync(join(tmpdir(), "codeharden-stub-bin-"));
  const state = mkdtempSync(join(tmpdir(), "codeharden-stub-gh-"));
  mkdirSync(join(state, "vars"));
  const all = {
    full_name: "example/example-harden",
    default_branch: "harden",
    has_issues: "true",
    actions_enabled: "true",
    labels: "",
    ...settings,
  };
  for (const [name, value] of Object.entries(all)) {
    if (name === "vars") continue;
    writeFileSync(join(state, name), value === "" ? "" : `${value}\n`);
  }
  for (const [name, value] of Object.entries(settings.vars ?? {})) {
    writeFileSync(join(state, "vars", name), `${value}\n`);
  }
  writeFileSync(join(state, "log"), "");
  writeFileSync(join(state, "git-log"), "");
  copyFileSync(STUB_GH, join(bin, "gh"));
  chmodSync(join(bin, "gh"), 0o755);
  const realGit = sh(tmpdir(), "/bin/sh", ["-c", "command -v git"]).out;
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${state}/git-log"`,
      'if [ -n "$GIT_STUB_REMOTES" ]; then',
      '  case "$1" in ls-remote | fetch | push)',
      "    n=$#",
      '    while [ "$n" -gt 0 ]; do',
      '      arg="$1"; shift',
      "      for pair in $GIT_STUB_REMOTES; do",
      // The part before the first "=" and the part after it.
      '        from=$(printf "%s" "$pair" | cut -d= -f1)',
      '        [ "$arg" != "$from" ] || arg=$(printf "%s" "$pair" | cut -d= -f2-)',
      "      done",
      '      set -- "$@" "$arg"',
      "      n=$((n - 1))",
      "    done ;;",
      "  esac",
      "fi",
      `exec "${realGit}" "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "git"), 0o755);
  const read = (name) =>
    existsSync(join(state, name)) ? readFileSync(join(state, name), "utf8") : "";
  return {
    state,
    env: { PATH: `${bin}:${process.env.PATH}`, GH_STATE: state },
    read,
    set: (name, value) => writeFileSync(join(state, name), `${value}\n`),
    variable: (name) => read(`vars/${name}`).trim(),
    ghCalls: () => read("log").split("\n").filter(Boolean),
    gitCalls: () => read("git-log").split("\n").filter(Boolean),
    clearLogs: () => {
      writeFileSync(join(state, "log"), "");
      writeFileSync(join(state, "git-log"), "");
    },
  };
}
