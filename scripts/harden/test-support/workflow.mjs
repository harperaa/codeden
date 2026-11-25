// A workflow file read as text, for the tests of this fork's own workflows: its jobs, what a
// job may do, and the shell it runs. The files can't be run before they are merged, so the
// tests hold them to the rules they state.
import { readFileSync } from "node:fs";

export const workflowFile = (name) =>
  readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8");

/** The text of each top-level job, by name. */
export function jobs(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  const out = {};
  let name = null;
  for (const line of body.split("\n")) {
    const start = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(line);
    if (start) {
      name = start[1];
      out[name] = "";
    } else if (name) out[name] += `${line}\n`;
  }
  return out;
}

/** The lines of every `run: |` block, joined. */
export function runBlocks(text) {
  const lines = text.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[2] && m[2] !== "|") {
      found.push(m[2]);
      continue;
    }
    const indent = m[1].length;
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() !== "" && line.search(/\S/) <= indent) {
        i--;
        break;
      }
      found.push(line);
    }
  }
  return found.join("\n");
}

/** A job's permissions as `name: level`, in the order written, without comments. */
export function permissions(job) {
  const lines = job.split("\n");
  const start = lines.indexOf("    permissions:");
  if (start < 0) return null;
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && line.search(/\S/) < 6) break;
    const text = line.trim();
    if (text !== "" && !text.startsWith("#")) out.push(text);
  }
  return out;
}

/** The trigger section: from `on:` to the top-level `permissions:`. */
export const triggers = (text) =>
  text.slice(text.indexOf("\non:\n"), text.indexOf("\npermissions:"));

/** The block between two marker comments, without its indentation's variation. */
export function marked(text, name) {
  return [...text.matchAll(new RegExp(`# ${name}:begin\\n([\\s\\S]*?)# ${name}:end`, "g"))].map(
    (m) => m[1],
  );
}

/** A dollar sign: workflow and shell text with `$` + `{` is written with it, not as a literal. */
export const D = "$";
/** The shell's `${script}`, as the workflows write it. */
export const SCRIPT = `${D}{script}`;
/** A workflow line `NAME: ${{ value }}`. */
export const expression = (name, value) => `${name}: ${D}{{ ${value} }}`;
