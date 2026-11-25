// setup-fork.sh against a stub `gh` and scratch git repositories standing in for the upstream
// and the fork on GitHub. Nothing here touches this checkout or GitHub.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { repository, sh, stubTools } from "./test-support/scratch.mjs";

const SETUP = fileURLToPath(new URL("./setup-fork.sh", import.meta.url));

/**
 * An upstream with `main` and `harden`, a fork that copied both (as GitHub's fork button
 * does) one commit ago, and a clone of the fork.
 */
function world(settings = {}) {
  const upstream = repository("codeharden-setup-up-", ["--initial-branch=main"]);
  upstream.commit("app.txt", "feat: the app");
  upstream.git("checkout", "--quiet", "-b", "harden");
  upstream.commit("hardening.txt", "feat: hardening");
  const fork = repository("codeharden-setup-fork-", ["--bare"]);
  upstream.git("push", "--quiet", fork.dir, "main", "harden");
  const clone = repository("codeharden-setup-clone-");
  clone.git("remote", "add", "origin", fork.dir);
  clone.git("fetch", "--quiet", "origin");
  clone.git("reset", "--quiet", "--hard", "origin/harden");
  // Upstream moved on after the fork was made.
  upstream.commit("later.txt", "fix: later upstream work");
  const tools = stubTools({
    actions_enabled: "false",
    "workflow-upstream-sync-merge.yml": "disabled_fork",
    "workflow-release.yml": "active",
    ...settings,
  });
  const run = (args = [], env = {}) =>
    sh(clone.dir, "bash", [SETUP, "--repo", "example/example-harden", ...args], {
      ...tools.env,
      SETUP_FORK_UPSTREAM_URL: upstream.dir,
      SETUP_FORK_REPO_URL: fork.dir,
      ...env,
    });
  const refs = (repo) => repo.git("for-each-ref", "--format=%(refname) %(objectname)");
  return { upstream, fork, clone, tools, run, refs };
}

const lines = (out, word) => out.split("\n").filter((line) => line.trimStart().startsWith(word));

describe("setup-fork.sh", () => {
  it("sets a fresh fork up, and a second run finds everything already set", () => {
    const w = world();
    const first = w.run(["--package", "example-harden"]);
    expect(first.err).toBe("");
    expect(first.code).toBe(0);
    expect(first.out).toContain("hardened fork of harperaa/codeharden (harden)");
    expect(first.out).toContain("mirror branch: mirror   working branch: harden");

    expect(w.tools.variable("UPSTREAM_REPO")).toBe("harperaa/codeharden");
    expect(w.tools.variable("UPSTREAM_BRANCH")).toBe("harden");
    expect(w.tools.variable("PACKAGE_NAME")).toBe("example-harden");
    // The derived branch names need no variables.
    expect(w.tools.variable("HARDEN_BRANCH")).toBe("");
    expect(w.tools.variable("MIRROR_BRANCH")).toBe("");
    // The mirror is upstream's branch as it is now; the copied branches are untouched.
    expect(w.fork.git("rev-parse", "mirror")).toBe(w.upstream.git("rev-parse", "harden"));
    expect(w.fork.git("rev-parse", "harden")).toBe(w.clone.git("rev-parse", "HEAD"));
    expect(w.fork.git("rev-parse", "main")).toBe(w.upstream.git("rev-parse", "main"));
    expect(w.tools.read("labels").trim().split("\n")).toEqual([
      "sync-approved",
      "sync-needs-review",
      "sync-hold",
    ]);
    expect(w.tools.read("actions_enabled").trim()).toBe("true");
    expect(w.tools.read("workflow-upstream-sync-merge.yml").trim()).toBe("active");
    expect(w.tools.read("workflow-release.yml").trim()).toBe("disabled_manually");
    expect(lines(first.out, "changed")).toHaveLength(10);
    expect(first.out).toContain("Done: 10 changed, 2 already set, 0 not done.");
    expect(first.out).toContain("git config core.hooksPath scripts/harden/hooks");

    const forkRefs = w.refs(w.fork);
    w.tools.clearLogs();
    const second = w.run();
    expect(second.code).toBe(0);
    expect(lines(second.out, "changed")).toEqual([]);
    expect(second.out).toContain("Done: 0 changed, 12 already set, 0 not done.");
    expect(w.refs(w.fork)).toBe(forkRefs);
    expect(w.tools.ghCalls().filter((call) => /--method|variable set/.test(call))).toEqual([]);
    expect(w.tools.gitCalls().filter((call) => /^(.* )?push /.test(call))).toEqual([]);
  });

  it("changes nothing in a dry run, here or on GitHub", () => {
    const w = world();
    const before = [w.refs(w.fork), w.refs(w.clone), w.tools.read("labels")];
    const fetchHead = readFileSync(join(w.clone.dir, ".git", "FETCH_HEAD"), "utf8");
    const result = w.run(["--package", "example-harden", "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Dry run: nothing is changed");
    expect(lines(result.out, "would change")).toHaveLength(10);
    expect(lines(result.out, "changed")).toEqual([]);
    expect([w.refs(w.fork), w.refs(w.clone), w.tools.read("labels")]).toEqual(before);
    expect(readFileSync(join(w.clone.dir, ".git", "FETCH_HEAD"), "utf8")).toBe(fetchHead);
    expect(w.tools.variable("PACKAGE_NAME")).toBe("");
    expect(w.tools.read("actions_enabled").trim()).toBe("false");
    expect(w.tools.read("workflow-release.yml").trim()).toBe("active");
    expect(w.tools.ghCalls().filter((call) => /--method|variable set/.test(call))).toEqual([]);
    expect(
      w.tools.gitCalls().filter((call) => /(^| )(push|fetch|commit|branch|update-ref) /.test(call)),
    ).toEqual([]);
  });

  it("never passes a force flag, a forced refspec or a delete to git or gh", () => {
    const w = world();
    w.run(["--package", "example-harden"]);
    w.upstream.commit("more.txt", "fix: more upstream work");
    w.run();
    const calls = [...w.tools.gitCalls(), ...w.tools.ghCalls()];
    expect(calls.some((call) => / push /.test(` ${call}`))).toBe(true);
    for (const call of calls) {
      const args = call.split(" ");
      expect(args, call).not.toContain("--force");
      expect(args, call).not.toContain("-f");
      expect(args, call).not.toContain("--delete");
      expect(args, call).not.toContain("DELETE");
      expect(
        args.some((arg) => arg.startsWith("--force") || arg.startsWith("+") || /^:/.test(arg)),
        call,
      ).toBe(false);
    }
  });

  it("fast-forwards a mirror that is behind, and leaves alone one with its own commits", () => {
    const w = world();
    w.run(["--package", "example-harden"]);
    const tip = w.upstream.commit("more.txt", "fix: more upstream work");
    const behind = w.run();
    expect(behind.code).toBe(0);
    expect(lines(behind.out, "changed")).toHaveLength(1);
    expect(behind.out).toContain("mirror branch mirror fast-forwarded to upstream harden");
    expect(w.fork.git("rev-parse", "mirror")).toBe(tip);

    // Someone committed to the mirror: not a mirror any more, and not this script's to fix.
    w.clone.git("fetch", "--quiet", "origin", "mirror");
    w.clone.git("checkout", "--quiet", "-b", "strayed", "FETCH_HEAD");
    const stray = w.clone.commit("stray.txt", "feat: committed to the mirror");
    w.clone.git("push", "--quiet", "origin", "strayed:mirror");
    w.upstream.commit("again.txt", "fix: upstream again");
    const diverged = w.run();
    expect(diverged.code).toBe(1);
    expect(diverged.out).toContain("have diverged, so it can't be fast-forwarded. Left alone.");
    expect(diverged.out).toContain("Not done, for you to look at:");
    expect(w.fork.git("rev-parse", "mirror")).toBe(stray);
  });

  it("says which permission a refused step needs, and carries on with the rest", () => {
    const w = world();
    w.tools.set("deny-variables", "1");
    const result = w.run(["--package", "example-harden"]);
    expect(result.code).toBe(1);
    expect(lines(result.out, "not done")).toHaveLength(3);
    expect(result.out).toContain("set the repository variable PACKAGE_NAME to example-harden");
    expect(result.out).toContain("admin rights needed");
    // The branches, labels and workflows were still done.
    expect(w.fork.git("rev-parse", "mirror")).toBe(w.upstream.git("rev-parse", "harden"));
    expect(w.tools.read("labels")).toContain("sync-hold");
    expect(w.tools.read("workflow-release.yml").trim()).toBe("disabled_manually");
    expect(result.out).toContain("7 changed, 2 already set, 3 not done.");
  });

  it("takes other branch names, and stores them as variables", () => {
    const w = world({ default_branch: "main" });
    const result = w.run([
      "--package",
      "@example/harden",
      "--branch",
      "work",
      "--mirror-branch",
      "upstream-copy",
    ]);
    expect(result.code).toBe(0);
    expect(w.tools.variable("HARDEN_BRANCH")).toBe("work");
    expect(w.tools.variable("MIRROR_BRANCH")).toBe("upstream-copy");
    const tip = w.upstream.git("rev-parse", "harden");
    expect(w.fork.git("rev-parse", "upstream-copy")).toBe(tip);
    expect(w.fork.git("rev-parse", "work")).toBe(tip);
    expect(w.tools.read("default_branch").trim()).toBe("work");
    expect(result.out).toContain("default branch is work (was main)");
    // A second run needs no options: the variables hold them.
    const second = w.run();
    expect(second.out).toContain("0 changed");
    expect(second.out).toContain("mirror branch: upstream-copy   working branch: work");
  });

  it("would only create the three variables in CodeHarden's own repository", () => {
    const w = world({
      full_name: "harperaa/codeharden",
      actions_enabled: "true",
      labels: "bug\nsync-approved\nsync-needs-review\nsync-hold",
      "workflow-upstream-sync-merge.yml": "active",
      "workflow-release.yml": "disabled_manually",
    });
    const result = w.run(["--repo", "harperaa/codeharden", "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("hardened fork of leonvanzyl/codeden (main)");
    expect(result.out).toContain(
      "mirror branch: main   working branch: harden   npm package: codeharden",
    );
    expect(lines(result.out, "would change")).toEqual([
      "  would change  UPSTREAM_REPO = leonvanzyl/codeden (new)",
      "  would change  UPSTREAM_BRANCH = main (new)",
      "  would change  PACKAGE_NAME = codeharden (new)",
    ]);
    expect(result.out).toContain("Dry run: 3 would change, 9 already set, 0 not done.");
  });

  it("refuses a fork without its own package name, and malformed names", () => {
    const w = world();
    const none = w.run();
    expect(none.code).toBe(1);
    expect(none.err).toContain("pass --package <name>");
    expect(w.run(["--package", "codeharden"]).err).toContain("CodeHarden's own npm package");
    expect(w.run(["--package", "Example Harden"]).err).toContain("--package must be");
    expect(w.run(["--package", "x", "--upstream", "https://github.com/a/b"]).err).toContain(
      "--upstream must be",
    );
    expect(w.run(["--package", "x", "--branch", "a..b"]).err).toContain("--branch must be");
    expect(w.run(["--package", "x", "--mirror-branch", "harden"]).err).toContain("must differ");
    expect(w.run(["--package", "x", "--upstream", "example/example-harden"]).err).toContain(
      "is example/example-harden itself",
    );
    expect(w.tools.ghCalls().filter((call) => /--method|variable set/.test(call))).toEqual([]);
    expect(w.fork.git("for-each-ref", "--format=%(refname)")).toBe(
      "refs/heads/harden\nrefs/heads/main",
    );
  });
});
