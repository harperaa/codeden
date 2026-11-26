/**
 * `findRunningServer`: whether a server is already running for this home. `start`, `stop` and
 * `doctor` act on the answer, so a stale or foreign `server.json` must never count as one.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HealthResponse, ServerLock } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRunningServer } from "../src/running";

const HEALTH: HealthResponse = { ok: true, name: "codeden", version: "1.2.3", uptimeSec: 4 };

let dir: string;
let lockFile: string;
let servers: Server[];
/** Paths of the requests the local servers received. */
let requests: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-running-"));
  lockFile = join(dir, "server.json");
  servers = [];
  requests = [];
});
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((done) => s.close(done))));
  rmSync(dir, { recursive: true, force: true });
});

/** A local HTTP server that answers every request with `body`; resolves to its port. */
async function answering(body: string, contentType = "application/json"): Promise<number> {
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    res.writeHead(200, { "content-type": contentType }).end(body);
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return (server.address() as AddressInfo).port;
}

/** A port nothing listens on: one a server had and gave back. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

/** The id of a process that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  if (!child.pid) throw new Error("no child process");
  return child.pid;
}

function writeLock(lock: Partial<ServerLock>): ServerLock {
  const full = {
    pid: process.pid,
    port: 1,
    version: "1.2.3",
    startedAt: new Date().toISOString(),
    ...lock,
  } as ServerLock;
  writeFileSync(lockFile, JSON.stringify(full));
  return full;
}

describe("findRunningServer", () => {
  it("finds nothing without a lock file", async () => {
    expect(await findRunningServer(lockFile)).toBeUndefined();
  });

  it("finds nothing in a lock file that is not JSON", async () => {
    writeFileSync(lockFile, "{ not json");
    expect(await findRunningServer(lockFile)).toBeUndefined();
  });

  it("finds nothing in a lock file that is not a server lock, and asks nothing", async () => {
    const port = await answering(JSON.stringify(HEALTH));
    for (const lock of [
      { port },
      { pid: process.pid, port: 0, version: "1", startedAt: new Date().toISOString() },
      { pid: -1, port, version: "1", startedAt: new Date().toISOString() },
      { pid: String(process.pid), port, version: "1", startedAt: new Date().toISOString() },
      [],
      null,
    ]) {
      writeFileSync(lockFile, JSON.stringify(lock));
      expect(await findRunningServer(lockFile)).toBeUndefined();
    }
    expect(requests).toEqual([]);
  });

  it("finds nothing when the recorded process is gone, without asking its port", async () => {
    const port = await answering(JSON.stringify(HEALTH));
    writeLock({ pid: deadPid(), port });
    expect(await findRunningServer(lockFile)).toBeUndefined();
    expect(requests).toEqual([]);
  });

  it("gives the lock of a live process whose port answers the health check", async () => {
    const port = await answering(JSON.stringify(HEALTH));
    const lock = writeLock({ port });
    expect(await findRunningServer(lockFile)).toEqual(lock);
    expect(requests).toEqual(["/api/health"]);
  });

  it("finds nothing when another program answers on the recorded port", async () => {
    for (const [body, type] of [
      [JSON.stringify({ ok: true, name: "something-else", version: "1", uptimeSec: 1 })],
      [JSON.stringify({ ok: false, name: "codeden", version: "1", uptimeSec: 1 })],
      [JSON.stringify({ status: "up" })],
      ["<html>hello</html>", "text/html"],
      [""],
    ] as Array<[string, string?]>) {
      writeLock({ port: await answering(body, type) });
      expect(await findRunningServer(lockFile)).toBeUndefined();
    }
    expect(requests).toHaveLength(5);
  });

  it("finds nothing when the recorded port refuses the connection", async () => {
    writeLock({ port: await closedPort() });
    expect(await findRunningServer(lockFile)).toBeUndefined();
  });
});
