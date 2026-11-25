import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, ProviderCommand } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderSession } from "../src/adapter";
import { OpenCodeAdapter } from "../src/opencode/adapter";
import type { OpenCodeClient } from "../src/opencode/client";
import { OpenCodeCommands } from "../src/opencode/commands";
import { hardenListedCommands } from "../src/opencode/harden-commands";

/** A client whose lists hold two commands and the given skills. */
function stubClient(skills: unknown[] = [{ id: "pdf", name: "pdf", path: "/s/pdf/SKILL.md" }]) {
  return {
    get: async (path: string) => ({
      data: path.startsWith("/api/command")
        ? [{ name: "hello", description: "Says hello" }, { name: "team/review" }]
        : skills,
    }),
  } as unknown as OpenCodeClient;
}

describe("slash commands in OpenCode sessions are plain prompts in this fork", () => {
  it("drops the commands OpenCode lists", () => {
    expect(hardenListedCommands([{ name: "hello" }])).toEqual([]);
  });

  it("reports the skills only, and routes /<command> as a prompt", async () => {
    const reported: ProviderCommand[][] = [];
    const client = stubClient();
    const commands = new OpenCodeCommands("/work/repo", (list) => reported.push(list), 1);
    await commands.refresh(client);

    expect(reported).toEqual([[{ name: "pdf", description: "", kind: "skill" }]]);
    expect(commands.route("/hello world")).toEqual({ type: "prompt" });
    expect(commands.route("/team/review")).toEqual({ type: "prompt" });
    expect(commands.route("/pdf read this")).toMatchObject({ type: "skill", id: "pdf" });
    // Also for a first message, which waits for OpenCode's lists before it is routed.
    expect(await commands.resolve("/hello world", client)).toEqual({ type: "prompt" });
  });

  it("reports nothing when OpenCode lists commands alone", async () => {
    const reported: ProviderCommand[][] = [];
    const commands = new OpenCodeCommands("/work/repo", (list) => reported.push(list), 1);
    await commands.refresh(stubClient([]));

    expect(reported).toEqual([]);
    expect(commands.route("/hello")).toEqual({ type: "prompt" });
  });

  it("is switched on by nothing in the product", () => {
    const src = join(import.meta.dirname, "..", "src");
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) =>
      /\.[cm]?tsx?$/.test(f),
    );
    expect(files.length).toBeGreaterThan(100);
    const naming = files.filter((f) =>
      readFileSync(join(src, f), "utf8").includes("runOpenCodeCommandsInTests"),
    );
    expect(naming.map((f) => f.replaceAll("\\", "/"))).toEqual(["opencode/harden-commands.ts"]);
  });
});

// ------------------------------------------------------- against the fake `opencode serve`

const fakeOpenCode = {
  kind: "node-script" as const,
  path: process.execPath,
  script: join(import.meta.dirname, "fixtures", "fake-opencode", "opencode.mjs"),
};

let dir: string;
const sessions: ProviderSession[] = [];
const logFile = () => join(dir, "requests.log");
const requests = (path: RegExp) =>
  (existsSync(logFile()) ? readFileSync(logFile(), "utf8").trim().split("\n") : [])
    .map((line) => JSON.parse(line) as { kind: string; path?: string; body?: unknown })
    .filter((r) => r.kind === "request" && path.test(r.path ?? ""));

/** Opens a session on the fake OpenCode (which lists the command `hello`) and collects its events. */
async function open() {
  const adapter = new OpenCodeAdapter({ executable: fakeOpenCode, noGuardPlugin: true });
  const session = await adapter.openSession({
    sessionId: "s1",
    role: "agent",
    cwd: dir,
    autonomy: "auto",
    mcpServers: [],
    additionalDirectories: [],
    planMode: false,
  });
  sessions.push(session);
  const all: AgentEvent[] = [];
  const events = session.events[Symbol.asyncIterator]();
  const turn = async (text: string) => {
    const from = all.length;
    await session.send({ text, attachments: [] });
    const deadline = Date.now() + 8000;
    for (;;) {
      const next = await Promise.race([
        events.next(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("timed out waiting for an event")),
            deadline - Date.now(),
          ),
        ),
      ]);
      if (next.done) throw new Error("event stream ended");
      all.push(next.value);
      if (next.value.type === "turn.completed" || next.value.type === "turn.failed") break;
    }
    return all.slice(from);
  };
  return { all, turn };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-opencode-plain-"));
  process.env.FAKE_OPENCODE_LOG = logFile();
  process.env.FAKE_OPENCODE_STATE = join(dir, "state.json");
});

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  delete process.env.FAKE_OPENCODE_LOG;
  delete process.env.FAKE_OPENCODE_STATE;
});

describe("an OpenCode session in this fork", () => {
  it("sends /<command> as a plain prompt and never uses the command route", async () => {
    const { all, turn } = await open();

    // The first message, then one after OpenCode has announced its lists.
    for (const text of ["/hello there", "/hello big world"]) {
      const ran = await turn(text);
      expect(ran.some((e) => e.type === "turn.completed")).toBe(true);
    }

    expect(requests(/^\/api\/session\/[^/]+\/command$/)).toEqual([]);
    expect(requests(/\/prompt$/).map((r) => r.body)).toEqual([
      { text: "/hello there" },
      { text: "/hello big world" },
    ]);
    const offered = all.flatMap((e) => (e.type === "session.updated" ? (e.commands ?? []) : []));
    expect(offered.filter((c) => c.kind === "command")).toEqual([]);
  });
});
