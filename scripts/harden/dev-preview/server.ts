/**
 * The server half of this repository's dev preview (`run.mjs`): `apps/server/src/dev.ts` with
 * the web app's port taken from the environment, so that the server accepts the Vite dev
 * server it is paired with. Upstream's dev entry is left as it is.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureHome } from "../../../apps/server/src/paths";
import { startServer } from "../../../apps/server/src/server";
import { ensureInstallToken } from "../../../apps/server/src/token";

const home = process.env.CODEDEN_HOME;
const port = Number(process.env.CODEDEN_PORT);
const webPort = Number(process.env.DEV_PREVIEW_WEB_PORT);
if (!home || !Number.isInteger(port) || !Number.isInteger(webPort)) {
  throw new Error("Start this through scripts/harden/dev-preview/run.mjs.");
}

const server = await startServer({
  port,
  dataDir: home,
  token: ensureInstallToken(ensureHome(home).token),
  enableFakeProvider: true,
  allowedOrigins: [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`],
  log: (m) => console.log(`[dev-preview] ${m}`),
});
console.log(`[dev-preview] UI (vite): http://localhost:${webPort}   API: ${server.url}`);

// `run.mjs` leaves this file when the whole preview ends; a reload by `node --watch` doesn't,
// so the runner and its sessions carry on across reloads.
const stop = () =>
  void server
    .close({ stopRunner: existsSync(join(home, "stop-runner")) })
    .then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
