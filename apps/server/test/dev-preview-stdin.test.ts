import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A preview's commands get no input: their stdin is closed (the null device), and their output
 * is a pipe, never a terminal. A dev server that would ask a question in a terminal (an upgrade
 * menu, a "port in use, use another?") therefore finds no terminal and goes on without asking,
 * and one that reads anyway gets the end of input instead of waiting for an answer nobody can
 * give. This pins the options the process is started with; the behaviour itself is tested with
 * real processes in `dev-preview-process.test.ts` (`pnpm test:slow`).
 */
const spawned = vi.hoisted(() => ({ calls: [] as Array<{ options: Record<string, unknown> }> }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: (_file: string, _args: string[], options: Record<string, unknown>) => {
    spawned.calls.push({ options });
    // A child that never started: no pid, so nothing is looked up or signalled.
    return new EventEmitter();
  },
}));

beforeEach(() => {
  spawned.calls.length = 0;
});

describe("how a preview's command is started", () => {
  it("has its input closed and its output on pipes, for the prepare and the dev command alike", async () => {
    const { spawnPreview } = await import("../src/services/dev-preview/process");
    spawnPreview({ command: "npm ci", cwd: process.cwd(), env: {}, onOutput: () => {} });
    spawnPreview({ command: "npm run dev", cwd: process.cwd(), env: {}, onOutput: () => {} });
    expect(spawned.calls).toHaveLength(2);
    for (const { options } of spawned.calls) {
      expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
    }
  });
});
