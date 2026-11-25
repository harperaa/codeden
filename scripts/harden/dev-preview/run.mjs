#!/usr/bin/env node
// This repository's dev command for a dev preview (docs/dev-preview.md): the server and the
// web app of the checkout this script is in, on the two ports it is given, with a home of
// their own inside the checkout. `pnpm dev` can't be used for this: its ports are fixed
// (4318 and 5173), so two worktrees could never run it side by side.
//
//   WEB_PORT   the web app (Vite), the page to open. PORT is read when WEB_PORT is not set.
//   API_PORT   the server behind it.
//
// Project settings > Dev preview:
//   Dev command      node scripts/harden/dev-preview/run.mjs
//   Prepare command  pnpm install --frozen-lockfile
//   Port variables   WEB_PORT, API_PORT
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const port = (name, fallback) => {
  const value = Number(process.env[name] ?? (fallback ? process.env[fallback] : undefined));
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    console.error(`dev-preview: set ${name} to a free port (1024-65535).`);
    process.exit(2);
  }
  return value;
};
const webPort = port("WEB_PORT", "PORT");
const apiPort = port("API_PORT");
if (webPort === apiPort) {
  console.error("dev-preview: WEB_PORT and API_PORT must differ.");
  process.exit(2);
}
// A home of its own: inside `.codeden-dev/`, which git ignores, but not the one `pnpm dev`
// uses in this checkout, and never another checkout's or an installed app's.
const home = join(root, ".codeden-dev", "preview");
/** Written when the preview ends, so that the server takes its runner down with it. */
const stopRunnerFlag = join(home, "stop-runner");

// One server per home. A second one over the same database would break both.
try {
  const lock = JSON.parse(readFileSync(join(home, "server.json"), "utf8"));
  const health = await fetch(`http://127.0.0.1:${Number(lock.port)}/api/health`, {
    signal: AbortSignal.timeout(1_500),
  });
  if (health.ok) {
    console.error(`dev-preview: a server already runs over ${home} (port ${lock.port}).`);
    process.exit(2);
  }
} catch {
  // No lock file, or nothing answers on its port: the home is free.
}
mkdirSync(home, { recursive: true });
rmSync(stopRunnerFlag, { force: true });
const env = {
  ...process.env,
  CODEDEN_HOME: home,
  CODEDEN_PORT: String(apiPort),
  CODEDEN_SERVER_URL: `http://127.0.0.1:${apiPort}`,
  DEV_PREVIEW_WEB_PORT: String(webPort),
};

const children = [
  spawn(
    process.execPath,
    [
      "--watch",
      "--watch-preserve-output",
      "--import",
      "tsx",
      join(root, "scripts/harden/dev-preview/server.ts"),
    ],
    { cwd: join(root, "apps/server"), env, stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [
      join(root, "apps/web/node_modules/vite/bin/vite.js"),
      "--port",
      String(webPort),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { cwd: join(root, "apps/web"), env, stdio: "inherit" },
  ),
];

let ending = false;
function end(code) {
  if (ending) return;
  ending = true;
  // The dev server starts a runner that outlives it on purpose. A preview takes it down too:
  // the server reads this file when it is told to stop, and asks its own runner to end. No
  // process is signalled by an id read from a file.
  try {
    writeFileSync(stopRunnerFlag, "");
  } catch {
    // The runner then stays, as after `pnpm dev`.
  }
  for (const child of children) child.kill("SIGTERM");
  const left = () => children.filter((c) => c.exitCode === null && c.signalCode === null);
  const done = () => left().length === 0 && process.exit(code);
  for (const child of children) child.once("exit", done);
  done();
  setTimeout(() => {
    for (const child of left()) child.kill("SIGKILL");
    process.exit(code);
  }, 8_000).unref();
}

for (const child of children) {
  child.once("exit", (code) => end(code ?? 1));
  child.once("error", (error) => {
    console.error(`dev-preview: ${error.message}`);
    end(1);
  });
}
process.on("SIGINT", () => end(0));
process.on("SIGTERM", () => end(0));
console.log(
  `dev-preview: web http://localhost:${webPort}  api http://127.0.0.1:${apiPort}  home ${home}`,
);
