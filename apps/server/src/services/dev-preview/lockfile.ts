import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../json-file";

/** The files whose change means dependencies must be installed again. Looked up at the root. */
const LOCKFILES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "requirements.txt",
  "Gemfile.lock",
  "composer.lock",
];

/** A digest of the folder's lockfiles and the prepare command that would install from them. */
export function prepareDigest(dir: string, prepareCommand: string): string {
  const hash = createHash("sha256").update(prepareCommand).update("\0");
  // The folder itself: a worktree that was cleaned up and made again at the same path is a
  // new folder with nothing installed in it, whatever its lockfiles say.
  try {
    const folder = statSync(dir);
    hash.update(`${folder.ino}:${folder.birthtimeMs}`).update("\0");
  } catch {
    // No folder: nothing was prepared in it.
  }
  for (const name of LOCKFILES) {
    try {
      const content = readFileSync(join(dir, name));
      hash.update(name).update("\0").update(content).update("\0");
    } catch {
      // Not there.
    }
  }
  return hash.digest("hex");
}

/** Most names kept per folder; an install makes a handful. */
const MADE_MAX = 64;

/** What a folder's top level holds: each entry's name with what tells it from another one. */
export type FolderSnapshot = ReadonlyMap<string, string>;

/**
 * The folder's own entries (not what is inside them), each with its inode and the time it was
 * last changed. Git's own entry is left out. A folder that isn't there has none.
 */
export function snapshotFolder(dir: string): FolderSnapshot {
  const entries = new Map<string, string>();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return entries;
  }
  for (const name of names) {
    if (name === ".git") continue;
    try {
      // The entry itself: a link counts as what it is, wherever it points.
      const stat = lstatSync(join(dir, name));
      entries.set(name, `${stat.ino}:${stat.mtimeMs}`);
    } catch {
      // Gone between the two looks.
    }
  }
  return entries;
}

function isThere(dir: string, name: string): boolean {
  try {
    lstatSync(join(dir, name));
    return true;
  } catch {
    return false;
  }
}

const Entry = z.object({
  /** `prepareDigest` when the prepare command last succeeded here. */
  digest: z.string(),
  /** What that run made or changed at the folder's top level (`node_modules`, `.venv`). */
  made: z.array(z.string()).max(MADE_MAX).default([]),
});
type Entry = z.infer<typeof Entry>;

/**
 * Remembers, per folder, what the prepare command last ran for, so it runs before the first
 * start in a worktree and again when a lockfile (or the command) changed, and not otherwise.
 * Kept in the app's home, never in the worktree, where it would show up as a change.
 *
 * The digest alone can't tell that the install's result is gone (someone removed
 * `node_modules`, a clean-up took the ignored files): the folder and its lockfile are the same,
 * and the dev command would start with nothing installed. So with the digest goes what the
 * prepare command made: the entries of the folder's top level that were new or changed when it
 * ended. When one of them is missing, the folder is not prepared, whatever the digest says. No
 * name is known in advance; what counts is what the command itself did. An entry that was
 * recorded and never was the install's (a tracked file a script touched) costs one more prepare
 * when it goes away, and is dropped by that run.
 *
 * A record from before this was kept has nothing to check, so it is not trusted: each folder
 * is prepared once more.
 */
export class PreparedStore {
  private readonly seen: Record<string, Entry> = {};

  constructor(private readonly file: string) {
    const raw = readJsonFile(file);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    for (const [dir, value] of Object.entries(raw)) {
      const entry = Entry.safeParse(value);
      if (entry.success) this.seen[dir] = entry.data;
    }
  }

  needs(dir: string, prepareCommand: string): boolean {
    const entry = this.seen[dir];
    if (!entry || entry.digest !== prepareDigest(dir, prepareCommand)) return true;
    return entry.made.some((name) => !isThere(dir, name));
  }

  /**
   * The prepare command just succeeded in `dir`. `before` is the folder as it was when the
   * command started (`snapshotFolder`): what is new or changed since is what it made.
   */
  record(dir: string, prepareCommand: string, before: FolderSnapshot = new Map()): void {
    const after = snapshotFolder(dir);
    const made = new Set<string>();
    for (const [name, identity] of after) {
      if (before.get(name) !== identity) made.add(name);
    }
    // What an earlier run made and this one left as it was is still the install's.
    for (const name of this.seen[dir]?.made ?? []) {
      if (after.has(name)) made.add(name);
    }
    this.seen[dir] = {
      digest: prepareDigest(dir, prepareCommand),
      made: [...made].sort().slice(0, MADE_MAX),
    };
    this.write();
  }

  forget(dir: string): void {
    if (!(dir in this.seen)) return;
    delete this.seen[dir];
    this.write();
  }

  private write(): void {
    try {
      writeJsonFile(this.file, this.seen, 0o600);
    } catch {
      // A prepare that isn't remembered runs again next time; nothing is lost.
    }
  }
}
