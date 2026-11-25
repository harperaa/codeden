import { describe, expect, it } from "vitest";
import {
  DevPreviewProject,
  DevPreviewRecommended,
  DevPreviewSettings,
  devPreviewNeedsRecommendedPorts,
  devPreviewPortCount,
  hardenDevPreviewRecommended,
  hardenDevPreviewSettings,
} from "../src/index";

const roundTrip = <T>(schema: { parse: (v: unknown) => T }, value: unknown): T =>
  schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));

describe("the recommended dev preview settings of this repository", () => {
  it("are the documented values, and valid settings as they stand", () => {
    const settings = hardenDevPreviewSettings();
    expect(settings).toEqual({
      command: "node scripts/harden/dev-preview/run.mjs",
      prepareCommand: "pnpm install --frozen-lockfile",
      portVars: ["WEB_PORT", "API_PORT"],
      urlFrom: "port",
      urlPattern: null,
      pmEnabled: false,
    });
    expect(roundTrip(DevPreviewSettings, settings)).toEqual(settings);
    expect(devPreviewPortCount(settings)).toBe(2);
  });

  it("round-trip in a project's view, and are null where a server doesn't send them", () => {
    const recommended = hardenDevPreviewRecommended();
    expect(roundTrip(DevPreviewRecommended, recommended)).toEqual(recommended);
    const view = {
      projectId: "p1",
      config: null,
      suggestion: null,
      baseBranch: "harden",
      remote: false,
    };
    expect(roundTrip(DevPreviewProject, { ...view, recommended }).recommended).toEqual(recommended);
    expect(roundTrip(DevPreviewProject, view).recommended).toBeNull();
  });

  it("stored settings with this dev command need its port variables, in its order", () => {
    const recommended = hardenDevPreviewSettings();
    const stored = (portVars: string[], command = recommended.command) => ({ command, portVars });
    // What the owner had: the command, with the form's default variable.
    expect(devPreviewNeedsRecommendedPorts(stored(["PORT"]), recommended)).toBe(true);
    expect(devPreviewNeedsRecommendedPorts(stored(["WEB_PORT"]), recommended)).toBe(true);
    // The first port is the page the link opens.
    expect(devPreviewNeedsRecommendedPorts(stored(["API_PORT", "WEB_PORT"]), recommended)).toBe(
      true,
    );
    expect(devPreviewNeedsRecommendedPorts(stored(["WEB_PORT", "API_PORT"]), recommended)).toBe(
      false,
    );
    expect(
      devPreviewNeedsRecommendedPorts(stored(["WEB_PORT", "API_PORT", "DB_PORT"]), recommended),
    ).toBe(false);
    // Another dev command is the person's own: nothing is said about its variables.
    expect(devPreviewNeedsRecommendedPorts(stored(["PORT"], "pnpm dev"), recommended)).toBe(false);
  });
});
