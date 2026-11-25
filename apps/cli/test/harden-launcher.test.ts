/**
 * The launcher on CodeHarden's update channel: it switches only to an installed copy of the
 * channel's package, at CodeHarden versions, and never to an upstream install in the same home.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions } from "@codeden/contracts";
import { cliEntry, writePointer } from "@codeden/server";
import { describe, expect, it } from "vitest";
import { HELP } from "../src/args";
import {
  compareCore,
  decideLaunch,
  managedEntry,
  managedProblem,
  readPinnedVersion,
  restartCommandFor,
} from "../src/launcher";

const CURRENT = "2026.1122.2006";
const NEXT = "2026.1123.905";

function copy(dir: string, name: string, version: string): string {
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version }));
  writeFileSync(join(dir, "dist", "cli.js"), "");
  return join(dir, "dist", "cli.js");
}

function setup() {
  const base = mkdtempSync(join(tmpdir(), "codeharden-launcher-"));
  const home = join(base, "home");
  const selfEntry = copy(join(base, "global", "node_modules", "codeharden"), "codeharden", CURRENT);
  return { base, home, selfEntry };
}

describe("the launcher on CodeHarden's channel", () => {
  it("finds installed versions where the server's installer puts them", () => {
    expect(managedEntry("/h", NEXT)).toBe(cliEntry("/h", NEXT));
    expect(managedEntry("/h", NEXT)).toBe(
      join("/h", "app", NEXT, "node_modules", "codeharden", "dist", "cli.js"),
    );
  });

  it("switches to a newer installed CodeHarden version", () => {
    const { home, selfEntry } = setup();
    copy(join(home, "app", NEXT, "node_modules", "codeharden"), "codeharden", NEXT);
    writePointer(home, NEXT, CURRENT);
    expect(readPinnedVersion(home)).toBe(NEXT);
    expect(decideLaunch({ selfEntry, selfVersion: CURRENT, home, env: {} })).toEqual({
      kind: "switch",
      version: NEXT,
      entry: managedEntry(home, NEXT),
    });
  });

  it("stays on itself when the pin is the same day's earlier build or an upstream version", () => {
    for (const pinned of ["2026.1122.905", "2026.105.2359", "0.7.8", "99.0.0"]) {
      const { home, selfEntry } = setup();
      copy(join(home, "app", pinned, "node_modules", "codeharden"), "codeharden", pinned);
      writePointer(home, pinned, CURRENT);
      const decision = decideLaunch({ selfEntry, selfVersion: CURRENT, home, env: {} });
      expect(decision, pinned).toEqual({ kind: "self", warning: null });
    }
  });

  it("never switches to an upstream install left in the same home", () => {
    const { home, selfEntry } = setup();
    // What upstream's updater leaves: its own package under its own name.
    copy(join(home, "app", "2027.1.1", "node_modules", "codeden"), "codeden", "2027.1.1");
    writePointer(home, "2027.1.1", "0.7.7");
    const decision = decideLaunch({ selfEntry, selfVersion: CURRENT, home, env: {} });
    expect(decision.kind).toBe("self");
    expect(decision.kind === "self" && decision.warning).toContain("Run `codeharden update`");
  });

  it("refuses an install in the channel's folder that is another package", () => {
    const { home, selfEntry } = setup();
    copy(join(home, "app", NEXT, "node_modules", "codeharden"), "codeden", NEXT);
    writePointer(home, NEXT, CURRENT);
    expect(managedProblem(home, NEXT)).toBe("it is the package codeden, not codeharden");
    const decision = decideLaunch({ selfEntry, selfVersion: CURRENT, home, env: {} });
    expect(decision.kind).toBe("self");
    expect(decision.kind === "self" && decision.warning).toContain(
      "it is the package codeden, not codeharden",
    );
  });

  it("orders CodeHarden versions like the contracts' comparison", () => {
    const versions = ["2026.105.518", "2026.1122.905", CURRENT, NEXT, "2027.101.0", "0.7.7"];
    for (const a of versions) {
      for (const b of versions) {
        expect(Math.sign(compareCore(a, b)), `${a} vs ${b}`).toBe(Math.sign(compareVersions(a, b)));
      }
    }
    expect(compareCore(NEXT, CURRENT)).toBeGreaterThan(0);
    expect(compareCore(CURRENT, "2026.1122.905")).toBeGreaterThan(0);
  });

  it("names the channel's command in what it tells people to type", () => {
    expect(restartCommandFor("npx", "/x/dist/cli.js")).toBe("npx codeharden");
    expect(restartCommandFor("npm", "/x/dist/cli.js")).toBe("codeharden");
    expect(HELP).toContain("\n  codeharden update ");
    expect(HELP).not.toMatch(/^ {2}codeden\b/m);
  });
});
