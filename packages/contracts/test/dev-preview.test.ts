import { describe, expect, it } from "vitest";
import {
  DEV_PREVIEW_NO_PREPARE_HINT,
  DEV_PREVIEW_RESERVED_PORTS,
  DevPreviewConfig,
  DevPreviewLimits,
  DevPreviewLimitsView,
  DevPreviewLog,
  DevPreviewProject,
  DevPreviewSettings,
  DevPreviewState,
  DevPreviewStopAll,
  DevPreviewSuggestion,
  defaultDevPreviewLimits,
  devPreviewBaseKey,
  devPreviewPortCount,
  devPreviewSessionKey,
  expandDevPreviewCommand,
  hardenDevPreviewRecommended,
  localPreviewUrl,
  previewUrlInLine,
  SetDevPreviewPmRequest,
  SetDevPreviewRequest,
} from "../src/index";

const roundTrip = <T>(schema: { parse: (v: unknown) => T }, value: unknown): T =>
  schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));
const NOW = "2026-11-23T10:00:00.000Z";

describe("dev preview contracts", () => {
  it("round-trips a project's settings, with defaults for what is left out", () => {
    expect(roundTrip(DevPreviewSettings, { command: " pnpm dev " })).toEqual({
      command: "pnpm dev",
      prepareCommand: null,
      portVars: ["PORT"],
      urlFrom: "port",
      urlPattern: null,
      // Off unless a person chose it: no preview starts by itself.
      pmEnabled: false,
    });
    // A stored "on" is the person's choice and stays on.
    expect(roundTrip(DevPreviewSettings, { command: "pnpm dev", pmEnabled: true }).pmEnabled).toBe(
      true,
    );
    const full = {
      command: "node dev.mjs --port {port}",
      prepareCommand: "pnpm install --frozen-lockfile",
      portVars: ["WEB_PORT", "API_PORT"],
      urlFrom: "output" as const,
      urlPattern: "Local:\\s+(\\S+)",
      pmEnabled: false,
    };
    expect(roundTrip(DevPreviewSettings, full)).toEqual(full);
    expect(roundTrip(DevPreviewConfig, { ...full, confirmedAt: NOW })).toEqual({
      ...full,
      confirmedAt: NOW,
      baseBranch: null,
    });
    expect(
      roundTrip(DevPreviewConfig, { ...full, confirmedAt: NOW, baseBranch: "harden" }).baseBranch,
    ).toBe("harden");
    // The branch is the server's record of what was confirmed: a request can't carry it.
    expect(
      SetDevPreviewRequest.parse({ ...full, confirm: true, baseBranch: "evil" }),
    ).not.toHaveProperty("baseBranch");
  });

  it("a request to set the commands must carry the confirmation", () => {
    expect(SetDevPreviewRequest.safeParse({ command: "x" }).success).toBe(false);
    expect(SetDevPreviewRequest.safeParse({ command: "x", confirm: false }).success).toBe(false);
    expect(SetDevPreviewRequest.safeParse({ command: "x", confirm: "true" }).success).toBe(false);
    expect(roundTrip(SetDevPreviewRequest, { command: "x", confirm: true }).confirm).toBe(true);
    expect(roundTrip(SetDevPreviewPmRequest, { enabled: false })).toEqual({ enabled: false });
  });

  it("takes only upper-case names that say they hold a port", () => {
    const ok = (portVars: unknown) =>
      DevPreviewSettings.safeParse({ command: "x", portVars }).success;
    expect(ok(["PORT", "VITE_PORT", "PORT_API", "WEB_PORT2"])).toBe(true);
    expect(ok(["API_PORT_INTERNAL", "P0RT_PORT"])).toBe(true);
    for (const bad of [
      // What a shell, a loader or a runtime reads to decide what to run.
      ["PATH"],
      ["HOME"],
      ["HOST"],
      ["NODE_OPTIONS"],
      ["BASH_ENV"],
      ["ENV"],
      ["ZDOTDIR"],
      ["LD_PRELOAD"],
      ["DYLD_INSERT_LIBRARIES"],
      ["PYTHONSTARTUP"],
      ["RUBYOPT"],
      ["GIT_DIR"],
      // Lower case reaches tools that read their settings from the environment.
      ["npm_config_port"],
      ["port"],
      ["Web_Port"],
      // Not names.
      ["PORT=1"],
      ["1PORT"],
      ["_PORT"],
      ["MY PORT"],
      [""],
      [],
    ]) {
      expect(ok(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(ok(["A_PORT", "B_PORT", "C_PORT", "D_PORT", "E_PORT"])).toBe(false);
  });

  it("round-trips the limits, and refuses a range too small or outside user ports", () => {
    expect(defaultDevPreviewLimits()).toEqual({
      perProject: 3,
      total: 6,
      portFrom: 43100,
      portTo: 43199,
    });
    expect(roundTrip(DevPreviewLimitsView, { limits: {}, remote: true }).limits.total).toBe(6);
    expect(DevPreviewLimits.safeParse({ portFrom: 5000, portTo: 5006 }).success).toBe(false);
    expect(DevPreviewLimits.safeParse({ portFrom: 5000, portTo: 5007 }).success).toBe(true);
    expect(DevPreviewLimits.safeParse({ portFrom: 80, portTo: 200 }).success).toBe(false);
    expect(DevPreviewLimits.safeParse({ perProject: 0 }).success).toBe(false);
    expect(DEV_PREVIEW_RESERVED_PORTS).toEqual([4317, 4417, 4318, 4319, 5173, 5174]);
  });

  it("round-trips the state, the project view, the log and the stop-all answer", () => {
    const state = {
      key: devPreviewBaseKey("p1"),
      kind: "base" as const,
      projectId: "p1",
      sessionId: null,
      status: "running" as const,
      enabled: true,
      url: "http://localhost:43100",
      ports: [43100, 43101],
      message: null,
      logTail: [],
      startedAt: NOW,
      configured: true,
      unavailable: null,
      remote: false,
      base: { branch: "harden", commit: "0123456789", checkedAt: NOW, blocked: false },
    };
    expect(roundTrip(DevPreviewState, state)).toEqual(state);
    const session = {
      ...state,
      key: devPreviewSessionKey("s1"),
      kind: "session" as const,
      sessionId: "s1",
      status: "failed" as const,
      url: null,
      message: "The prepare command exited with code 1.",
      logTail: ["ERR"],
      base: null,
    };
    expect(roundTrip(DevPreviewState, session)).toEqual(session);
    expect(DevPreviewState.safeParse({ ...state, status: "paused" }).success).toBe(false);
    const project = {
      projectId: "p1",
      config: null,
      suggestion: {
        command: "pnpm dev",
        prepareCommand: "pnpm install --frozen-lockfile",
        reason: "package.json has a dev script",
      },
      recommended: hardenDevPreviewRecommended(),
      baseBranch: "harden",
      notice: "The checkout was kept.",
      remote: false,
    };
    expect(roundTrip(DevPreviewProject, project)).toEqual(project);
    // A suggestion without a prepare command says so with null.
    const bare = { command: "npm run dev", reason: "package.json has a dev script" };
    expect(roundTrip(DevPreviewSuggestion, bare)).toEqual({ ...bare, prepareCommand: null });
    const hinted = {
      ...session,
      message: `The dev command exited with code 127 before anything was listening. ${DEV_PREVIEW_NO_PREPARE_HINT}`,
    };
    expect(roundTrip(DevPreviewState, hinted)).toEqual(hinted);
    expect(roundTrip(DevPreviewLog, { key: "session:s1", lines: ["a", "b"] }).lines).toEqual([
      "a",
      "b",
    ]);
    expect(roundTrip(DevPreviewStopAll, { stopped: 2 })).toEqual({ stopped: 2 });
  });
});

describe("ports in a command", () => {
  it("counts the ports a command and its variables need", () => {
    expect(devPreviewPortCount({ command: "dev", portVars: ["PORT"] })).toBe(1);
    expect(devPreviewPortCount({ command: "dev", portVars: ["A", "B"] })).toBe(2);
    expect(devPreviewPortCount({ command: "dev -p {port} -q {port3}", portVars: ["A"] })).toBe(3);
    expect(devPreviewPortCount({ command: "dev {port9}", portVars: ["A"] })).toBe(4);
  });

  it("replaces only the port placeholders, and only with whole numbers", () => {
    expect(expandDevPreviewCommand("dev -p {port} --api={port2} {port1}", [5000, 5001])).toBe(
      "dev -p 5000 --api=5001 5000",
    );
    // Nothing else in the text is touched, and a placeholder with no port stays as written.
    expect(expandDevPreviewCommand("echo $PORT $X {host} {port3} {PORT}", [5000])).toBe(
      "echo $PORT $X {host} {port3} {PORT}",
    );
    const hostile = [Number.NaN, 1.5, "1; rm -rf ~" as unknown as number];
    expect(expandDevPreviewCommand("a {port} {port2} {port3}", hostile)).toBe(
      "a {port} {port2} {port3}",
    );
  });
});

describe("the URL a preview may link", () => {
  it("is a local http address with a port, and nothing else", () => {
    expect(localPreviewUrl("http://localhost:5173/")).toEqual({
      url: "http://localhost:5173/",
      port: 5173,
    });
    expect(localPreviewUrl("https://127.0.0.1:8443/app?x=1")?.port).toBe(8443);
    expect(localPreviewUrl("http://[::1]:3000")?.port).toBe(3000);
    for (const bad of [
      "http://192.168.1.20:5173/",
      "http://example.com:5173/",
      "http://localhost.example.com:5173/",
      "http://localhost/",
      "http://user:pw@localhost:5173/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "localhost:5173",
      "",
    ]) {
      expect(localPreviewUrl(bad), bad).toBeNull();
    }
  });

  it("is found in a line of output, colour codes and all", () => {
    expect(
      previewUrlInLine(
        "  \u001b[32m➜\u001b[39m  Local:   \u001b[36mhttp://localhost:5173/\u001b[39m",
        null,
      ),
    ).toEqual({
      url: "http://localhost:5173/",
      port: 5173,
    });
    expect(previewUrlInLine("  ➜  Network: http://192.168.1.20:5173/", null)).toBeNull();
    expect(previewUrlInLine("listening (http://127.0.0.1:8080).", null)?.port).toBe(8080);
    expect(previewUrlInLine("nothing here", null)).toBeNull();
  });

  it("follows the project's pattern, and still links only local addresses", () => {
    const pattern = "App ready at (\\S+)";
    expect(
      previewUrlInLine(
        "Docs at http://localhost:6006 App ready at http://localhost:3001/x",
        pattern,
      ),
    ).toEqual({
      url: "http://localhost:3001/x",
      port: 3001,
    });
    expect(previewUrlInLine("App ready at http://evil.example:3001/", pattern)).toBeNull();
    expect(previewUrlInLine("Docs at http://localhost:6006", pattern)).toBeNull();
    // A pattern that stopped being valid never throws.
    expect(previewUrlInLine("x", "(")).toBeNull();
  });
});
