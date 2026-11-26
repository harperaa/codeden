import { afterEach, describe, expect, it } from "vitest";
import { diffTrees, parseNameStatus, parseNumStat } from "../src/git/diff";
import { makeRepo, removeDir, sh, write } from "./helpers";

/**
 * The file list of a diff (the changes panel, checkpoints, a reviewer's view of a branch) is
 * parsed from git's `-z` output, where a rename or copy takes two paths and a binary file has no
 * counts. A field read off by one shifts every entry after it, so the parsers are covered on
 * git's own formats, and `diffTrees` once against a real repository.
 */

const z = (...fields: string[]) => `${fields.join("\0")}\0`;

describe("parseNameStatus", () => {
  it("reads one path per entry for added, modified, deleted and type-changed files", () => {
    expect(parseNameStatus(z("A", "new.ts", "M", "src/a.ts", "D", "old.ts", "T", "link"))).toEqual([
      { status: "added", path: "new.ts" },
      { status: "modified", path: "src/a.ts" },
      { status: "deleted", path: "old.ts" },
      { status: "type_changed", path: "link" },
    ]);
  });

  it("reads two paths for a rename or copy, whatever its similarity score, and stays aligned", () => {
    const out = z("R100", "src/old.ts", "src/new.ts", "C75", "a.md", "b.md", "M", "after.ts");
    expect(parseNameStatus(out)).toEqual([
      { status: "renamed", path: "src/new.ts", oldPath: "src/old.ts" },
      { status: "copied", path: "b.md", oldPath: "a.md" },
      { status: "modified", path: "after.ts" },
    ]);
  });

  it("keeps paths with spaces, tabs and newlines whole", () => {
    expect(parseNameStatus(z("A", "my file.txt", "M", "tab\there", "A", "line\nbreak"))).toEqual([
      { status: "added", path: "my file.txt" },
      { status: "modified", path: "tab\there" },
      { status: "added", path: "line\nbreak" },
    ]);
  });

  it("treats a status it doesn't know as modified, and takes a Buffer", () => {
    expect(parseNameStatus(Buffer.from(z("U", "conflict.ts", "X", "odd.ts")))).toEqual([
      { status: "modified", path: "conflict.ts" },
      { status: "modified", path: "odd.ts" },
    ]);
  });

  it("returns nothing for an empty diff", () => {
    expect(parseNameStatus("")).toEqual([]);
    expect(parseNameStatus(Buffer.alloc(0))).toEqual([]);
  });
});

describe("parseNumStat", () => {
  it("reads additions, deletions and the path of each file", () => {
    expect(parseNumStat(z("3\t1\tsrc/a.ts", "0\t12\told.ts"))).toEqual([
      { path: "src/a.ts", additions: 3, deletions: 1, binary: false },
      { path: "old.ts", additions: 0, deletions: 12, binary: false },
    ]);
  });

  it("marks a binary file, with no counts", () => {
    expect(parseNumStat(z("-\t-\tassets/logo.png"))).toEqual([
      { path: "assets/logo.png", additions: 0, deletions: 0, binary: true },
    ]);
  });

  it("files a rename under its new path and stays aligned for the entries after it", () => {
    const out = z("2\t5\t", "src/old.ts", "src/new.ts", "-\t-\t", "a.png", "b.png", "1\t0\tz.ts");
    expect(parseNumStat(out)).toEqual([
      { path: "src/new.ts", additions: 2, deletions: 5, binary: false },
      { path: "b.png", additions: 0, deletions: 0, binary: true },
      { path: "z.ts", additions: 1, deletions: 0, binary: false },
    ]);
  });

  it("keeps a path with spaces whole", () => {
    expect(parseNumStat(z("1\t1\tdocs/my notes.md"))).toEqual([
      { path: "docs/my notes.md", additions: 1, deletions: 1, binary: false },
    ]);
  });

  it("returns nothing for an empty diff", () => {
    expect(parseNumStat("")).toEqual([]);
  });
});

describe("diffTrees", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) removeDir(dir);
  });

  /** A repository with a second commit that renames, edits, deletes and adds files. */
  function changedRepo(): string {
    const body = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const repo = makeRepo({
      "src/old name.ts": `${body}\n`,
      "edit.txt": "one\ntwo\n",
      "gone.txt": "bye\n",
      "other/keep.txt": "same\n",
    });
    dirs.push(repo);
    sh(repo, "mv", "src/old name.ts", "src/new name.ts");
    write(repo, "src/new name.ts", `${body}\nline 20\n`);
    write(repo, "edit.txt", "one\n2\n3\n");
    sh(repo, "rm", "-q", "gone.txt");
    write(repo, "logo.bin", Buffer.from([0, 1, 2, 0, 255, 254]));
    write(repo, "other/added.txt", "new\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-q", "-m", "change");
    return repo;
  }

  it("lists each file once with its status and counts, a rename under its new path", async () => {
    const repo = changedRepo();
    const { diff, files } = await diffTrees(repo, "HEAD~1", "HEAD");
    const byPath = [...files].sort((a, b) => a.path.localeCompare(b.path));
    expect(byPath).toEqual([
      { path: "edit.txt", status: "modified", additions: 2, deletions: 1, binary: false },
      { path: "gone.txt", status: "deleted", additions: 0, deletions: 1, binary: false },
      { path: "logo.bin", status: "added", additions: 0, deletions: 0, binary: true },
      { path: "other/added.txt", status: "added", additions: 1, deletions: 0, binary: false },
      {
        path: "src/new name.ts",
        oldPath: "src/old name.ts",
        status: "renamed",
        additions: 1,
        deletions: 0,
        binary: false,
      },
    ]);
    expect(diff).toContain("rename from src/old name.ts");
    expect(diff).toContain("+line 20");
  });

  it("limits the diff and the list to the given paths", async () => {
    const repo = changedRepo();
    const { diff, files } = await diffTrees(repo, "HEAD~1", "HEAD", ["other"]);
    expect(files).toEqual([
      { path: "other/added.txt", status: "added", additions: 1, deletions: 0, binary: false },
    ]);
    expect(diff).not.toContain("edit.txt");
  });

  it("is empty between a tree and itself", async () => {
    const repo = changedRepo();
    expect(await diffTrees(repo, "HEAD", "HEAD")).toEqual({ diff: "", files: [] });
  });
});
