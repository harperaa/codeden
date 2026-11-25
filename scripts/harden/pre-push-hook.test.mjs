// The pre-push hook (scripts/harden/hooks/pre-push): which pushes run the push checks (typecheck
// and lint) and which don't ("Checks before a push and in CI" in AGENTS.md). The hook runs in a
// scratch repository with a stub in place of push-checks.sh, so nothing real is started here;
// push-checks.test.mjs runs the checks script itself.
//
// The hook is started with an environment written out below, never with this process's own:
// when these tests run from the real hook, git's variables (GIT_DIR, GIT_INDEX_FILE, ...) must
// not reach the scratch repository, or its git commands would act on this checkout.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASE_ENV, repository } from "./test-support/scratch.mjs";

const HOOK = fileURLToPath(new URL("./hooks/pre-push", import.meta.url));
const ZERO = "0".repeat(40);
/** Stands in for push-checks.sh: leaves a mark that it ran, and passes or fails as told. */
const STUB = `#!/usr/bin/env bash
echo ran >> "$(dirname "$0")/checks-ran"
echo "stub checks: \${STUB_CHECKS:-pass}"
[ "\${STUB_CHECKS:-pass}" = pass ]
`;

/**
 * A repository with the hook and the stub checks, `origin/harden` at its first commit, and one
 * more commit checked out that changes `file`.
 */
function checkout(file = "apps/server/src/a.ts") {
  const repo = repository("codeharden-pre-push-test-");
  const scripts = join(repo.dir, "scripts", "harden");
  mkdirSync(join(scripts, "hooks"), { recursive: true });
  copyFileSync(HOOK, join(scripts, "hooks", "pre-push"));
  writeFileSync(join(scripts, "push-checks.sh"), STUB);
  chmodSync(join(scripts, "push-checks.sh"), 0o755);
  const base = repo.commit("base.txt", "base");
  repo.git("update-ref", "refs/remotes/origin/harden", base);
  mkdirSync(join(repo.dir, file, ".."), { recursive: true });
  const head = repo.commit(file, "change");
  /** Runs the hook as git does for a push of these `[local ref, sha, remote ref]` lines. */
  const push = (refs, env = {}) => {
    const input = refs.map(([local, sha, remote]) => `${local} ${sha} ${remote} ${ZERO}\n`);
    const result = spawnSync("bash", [join(scripts, "hooks", "pre-push"), "origin", "url"], {
      cwd: repo.dir,
      encoding: "utf8",
      input: input.join(""),
      env: { ...BASE_ENV, ...env },
    });
    return {
      code: result.status,
      err: result.stderr,
      ranChecks: existsSync(join(scripts, "checks-ran")),
    };
  };
  return { ...repo, base, head, push };
}

describe("the pre-push hook", () => {
  it("does not run the checks for a sync branch", () => {
    const repo = checkout();
    const pushed = repo.push(
      [["refs/heads/sync/2026-11-23", repo.head, "refs/heads/sync/2026-11-23"]],
      // Even checks that would fail are not asked: the sync review reports them instead.
      { STUB_CHECKS: "fail" },
    );
    expect(pushed).toMatchObject({ code: 0, ranChecks: false });
  });

  it("runs the checks for an ordinary branch and lets the push through when they pass", () => {
    const repo = checkout();
    const pushed = repo.push([["refs/heads/fix/a", repo.head, "refs/heads/fix/a"]]);
    expect(pushed).toMatchObject({ code: 0, ranChecks: true });
    expect(pushed.err).toContain("stub checks: pass");
  });

  it("refuses an ordinary branch whose checks fail", () => {
    const repo = checkout();
    const pushed = repo.push([["refs/heads/fix/a", repo.head, "refs/heads/fix/a"]], {
      STUB_CHECKS: "fail",
    });
    expect(pushed).toMatchObject({ code: 1, ranChecks: true });
  });

  it("only skips branches under sync/, not names that look like it", () => {
    for (const name of ["sync", "sync-2026-11-23", "fix/sync/a", "codeden/sync/a"]) {
      const repo = checkout();
      const ref = `refs/heads/${name}`;
      expect(repo.push([[ref, repo.head, ref]], { STUB_CHECKS: "fail" }), name).toMatchObject({
        code: 1,
        ranChecks: true,
      });
    }
  });

  it("still checks an ordinary branch pushed together with a sync branch", () => {
    const repo = checkout();
    const pushed = repo.push(
      [
        ["refs/heads/sync/2026-11-23", repo.head, "refs/heads/sync/2026-11-23"],
        ["refs/heads/fix/a", repo.head, "refs/heads/fix/a"],
      ],
      { STUB_CHECKS: "fail" },
    );
    expect(pushed).toMatchObject({ code: 1, ranChecks: true });
  });

  it("does not run the checks for tags, the working and mirror branches, deletions or docs", () => {
    const repo = checkout();
    const quiet = [
      ["refs/tags/v2026.0105.0518", repo.head, "refs/tags/v2026.0105.0518"],
      ["refs/heads/harden", repo.head, "refs/heads/harden"],
      ["refs/heads/main", repo.head, "refs/heads/main"],
      ["refs/heads/mirror", repo.head, "refs/heads/mirror"],
      ["(delete)", ZERO, "refs/heads/fix/gone"],
    ];
    expect(repo.push(quiet, { STUB_CHECKS: "fail" })).toMatchObject({ code: 0, ranChecks: false });
    const docs = checkout("docs/guide.md");
    expect(
      docs.push([["refs/heads/docs/a", docs.head, "refs/heads/docs/a"]], { STUB_CHECKS: "fail" }),
    ).toMatchObject({ code: 0, ranChecks: false });
  });

  it("lets a branch that is not the checked-out commit through with a note, running nothing", () => {
    const repo = checkout();
    const pushed = repo.push([["refs/heads/fix/a", repo.base, "refs/heads/fix/a"]]);
    // The first commit is origin/harden itself: nothing changed, so nothing to check.
    expect(pushed).toMatchObject({ code: 0, ranChecks: false });
    const other = repo.git("commit-tree", "-m", "other", "-p", repo.base, `${repo.head}^{tree}`);
    // Its files aren't in the checkout, so typecheck and lint can't judge it here; CI does.
    const skipped = repo.push([["refs/heads/fix/b", other, "refs/heads/fix/b"]]);
    expect(skipped).toMatchObject({ code: 0, ranChecks: false });
    expect(skipped.err).toContain("is not the checked-out commit");
  });
});
