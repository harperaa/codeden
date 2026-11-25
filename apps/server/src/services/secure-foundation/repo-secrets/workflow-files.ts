import { closeSync, constants, fstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { isOwnFolder } from "../folders";
import type { WorkflowFile } from "./scan";

/**
 * The workflow files of a project folder, read as text: `.github/workflows/*.yml` and `*.yaml`.
 * Only real files in a real `.github/workflows` folder of the project are read, never through a
 * link, so nothing outside the project is opened. At most `MAX_WORKFLOW_FILES` files of at most
 * `MAX_WORKFLOW_BYTES` each; the rest are counted as skipped.
 */
export const MAX_WORKFLOW_FILES = 50;
export const MAX_WORKFLOW_BYTES = 256 * 1024;

/** A plain file name: it is shown to the person as it is. */
const WORKFLOW = /^[A-Za-z0-9_][A-Za-z0-9._ -]{0,110}\.ya?ml$/i;

export interface WorkflowFiles {
  files: WorkflowFile[];
  /** Files that weren't read: over a limit, oddly named, or not readable. */
  skipped: number;
}

function readCapped(path: string): string | null {
  let fd: number | null = null;
  try {
    // `O_NOFOLLOW`: a link put in the file's place after the listing is refused, not followed.
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_WORKFLOW_BYTES) return null;
    const buffer = Buffer.alloc(stat.size);
    let read = 0;
    while (read < stat.size) {
      const count = readSync(fd, buffer, read, stat.size - read, read);
      if (count === 0) break;
      read += count;
    }
    const text = buffer.subarray(0, read).toString("utf8");
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function readWorkflowFiles(projectPath: string): WorkflowFiles {
  const dir = join(projectPath, ".github", "workflows");
  if (!isOwnFolder(join(projectPath, ".github")) || !isOwnFolder(dir)) {
    return { files: [], skipped: 0 };
  }
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return { files: [], skipped: 0 };
  }
  const files: WorkflowFile[] = [];
  let skipped = 0;
  for (const name of names) {
    const text =
      files.length < MAX_WORKFLOW_FILES && WORKFLOW.test(name) ? readCapped(join(dir, name)) : null;
    if (text === null) skipped++;
    else files.push({ name, text });
  }
  return { files, skipped };
}
