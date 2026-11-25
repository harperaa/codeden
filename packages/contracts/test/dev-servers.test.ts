import { describe, expect, it } from "vitest";
import {
  type DevPreviewServer,
  DevPreviewServerList,
  DevPreviewServersStopped,
  type DevPreviewState,
  devPreviewBaseKey,
  devPreviewSessionKey,
  StopDevPreviewServersRequest,
  sortDevPreviewServers,
} from "../src/index";

const roundTrip = <T>(schema: { parse: (v: unknown) => T }, value: unknown): T =>
  schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));

function server(
  projectName: string,
  sessionId: string | null,
  status: DevPreviewState["status"],
): DevPreviewServer {
  const projectId = `p-${projectName}`;
  return {
    projectName,
    sessionTitle: sessionId ? `Work ${sessionId}` : null,
    state: {
      key: sessionId ? devPreviewSessionKey(sessionId) : devPreviewBaseKey(projectId),
      kind: sessionId ? "session" : "base",
      projectId,
      sessionId,
      status,
      enabled: true,
      url: status === "running" ? "http://localhost:43100" : null,
      ports: status === "running" ? [43100] : [],
      message: status === "failed" ? "The dev command exited with code 1." : null,
      logTail: [],
      startedAt: "2026-11-24T10:00:00.000Z",
      configured: true,
      unavailable: null,
      remote: false,
      base: sessionId
        ? null
        : { branch: "main", commit: "0123456789", checkedAt: null, blocked: false },
    },
  };
}

describe("dev servers contracts", () => {
  it("round-trips the list, the stop request and its answer", () => {
    const list = { servers: [server("my-site", null, "running")], remote: true };
    expect(roundTrip(DevPreviewServerList, list)).toEqual(list);
    const keys = { keys: ["session:s1", "base:p1"] };
    expect(roundTrip(StopDevPreviewServersRequest, keys)).toEqual(keys);
    expect(StopDevPreviewServersRequest.safeParse({ keys: [] }).success).toBe(false);
    expect(StopDevPreviewServersRequest.safeParse({ keys: [""] }).success).toBe(false);
    const answer = {
      stopped: ["session:s1"],
      failed: [{ key: "base:p1", message: "It didn't end." }],
    };
    expect(roundTrip(DevPreviewServersStopped, answer)).toEqual(answer);
  });

  it("sorts running first, then the ones coming up, then the ended; by project, the PM thread first", () => {
    const sorted = sortDevPreviewServers([
      server("zeta", "s1", "failed"),
      server("beta", "s2", "running"),
      server("beta", null, "running"),
      server("Alpha", "s3", "starting"),
      server("alpha", "s4", "running"),
      server("beta", "s5", "preparing"),
      server("alpha", null, "stopped"),
    ]);
    expect(
      sorted.map((s) => `${s.projectName}:${s.state.sessionId ?? "pm"}:${s.state.status}`),
    ).toEqual([
      "alpha:s4:running",
      "beta:pm:running",
      "beta:s2:running",
      "Alpha:s3:starting",
      "beta:s5:preparing",
      "alpha:pm:stopped",
      "zeta:s1:failed",
    ]);
  });
});
