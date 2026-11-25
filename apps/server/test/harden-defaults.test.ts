import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ErrorInfo,
  HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT,
  PROVIDER_SWITCH_CODE,
  type Settings,
} from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsStore } from "../src/settings-store";
import { removeTree } from "./support/remove-tree";
import { withRoles } from "./support/role-env";
import { TEST_START } from "./support/test-clock";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "harden-defaults-"));
  file = join(dir, "settings.json");
});

afterEach(async () => {
  await removeTree(dir);
});

const onDisk = () => JSON.parse(readFileSync(file, "utf8")) as Settings;

describe("the provider switch at a usage limit ships off", () => {
  it("is off in a new install", () => {
    expect(HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT).toBe(false);
    expect(new SettingsStore(file).get().providers.autoSwitchOnLimit).toBe(false);
    expect(onDisk().providers.autoSwitchOnLimit).toBe(false);
  });

  it("is off for an install whose settings file is from before the setting existed", () => {
    // The role defaults a person chose, and no word about the switch.
    writeFileSync(file, JSON.stringify({ providers: { pm: { provider: "codex" } } }));
    const store = new SettingsStore(file);
    expect(store.get().providers).toMatchObject({
      pm: { provider: "codex" },
      autoSwitchOnLimit: false,
    });
    // Saving something else doesn't turn it on.
    expect(store.update({ appearance: { theme: "light" } }).providers.autoSwitchOnLimit).toBe(
      false,
    );
    expect(SettingsStore.read(file).providers.autoSwitchOnLimit).toBe(false);
  });

  it("stays on once a person turns it on", () => {
    const store = new SettingsStore(file);
    expect(
      store.update({ providers: { autoSwitchOnLimit: true } }).providers.autoSwitchOnLimit,
    ).toBe(true);
    expect(onDisk().providers.autoSwitchOnLimit).toBe(true);
    // A restart reads the person's choice, and another change keeps it.
    const again = new SettingsStore(file);
    expect(again.get().providers.autoSwitchOnLimit).toBe(true);
    expect(again.update({ appearance: { theme: "dark" } }).providers.autoSwitchOnLimit).toBe(true);
  });
});

describe("a project manager at its provider's usage limit, as the product ships", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: TEST_START });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const limit: ErrorInfo = { message: "You've hit your usage limit.", kind: "usage_limit" };
  const text = (value: string) => ({
    input: { text: value, attachments: [] },
    whenBusy: "queue" as const,
  });
  const both = [
    { id: "claude", readOnly: true },
    { id: "codex", readOnly: true },
  ];

  it(
    "stays on its provider and waits for the person, with another provider ready",
    withRoles(async (env) => {
      env.providers(both);
      env.asShipped();
      const pm = await env.roles.ensure("pm", "p1");
      env.settle(pm.id);
      await env.sessions.send(pm.id, text("Ship the fix"), "user");
      env.failTurn(pm.id, "t1", limit);
      await env.limits.idle();

      // The same session, failed like any other turn: nothing moved, stopped or announced.
      expect(env.livePms().map((s) => [s.id, s.provider, s.status])).toEqual([
        [pm.id, "claude", "failed"],
      ]);
      expect(env.stopped).toEqual([]);
      const notices = env.repo
        .rootItems(env.repo.get(pm.id), ["notice"])
        .filter((item) => item.kind === "notice" && item.code === PROVIDER_SWITCH_CODE);
      expect(notices).toEqual([]);
    }),
  );

  it(
    "moves once the person turns the setting on",
    withRoles(async (env) => {
      env.providers(both);
      env.asShipped();
      env.setQuietly({ providers: { autoSwitchOnLimit: true } });
      const pm = await env.roles.ensure("pm", "p1");
      env.settle(pm.id);
      await env.sessions.send(pm.id, text("Ship the fix"), "user");
      env.failTurn(pm.id, "t1", limit);
      await env.limits.idle();

      const [now] = env.livePms();
      expect(env.livePms()).toHaveLength(1);
      expect([now?.id === pm.id, now?.provider]).toEqual([false, "codex"]);
    }),
  );
});
