/**
 * The desktop updater pointed at CodeHarden's repository: a repository without releases, or
 * without installers on its releases, has no update feed. That is "nothing to install", told
 * quietly, never an error.
 */
import { describe, expect, it } from "vitest";
import {
  isMissingUpdateFile,
  UpdateController,
  type Updater,
} from "../src/main/updates/controller";

const NO_FEED = [
  "No published versions on GitHub",
  "Unable to find latest version on GitHub (https://github.com/harperaa/codeharden/releases/latest), please ensure a production release exists: Error: no tag\nstack",
  "Cannot find latest-mac.yml in the latest release artifacts (https://github.com/harperaa/codeharden/releases/download/v2026.1122.2006/latest-mac.yml): HttpError: 404\nstack",
  "HttpError: 404 Not Found",
];

function controllerFailingWith(message: string) {
  const logs: string[] = [];
  const updater: Updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: () => undefined,
    checkForUpdates: async () => {
      throw new Error(message);
    },
    downloadUpdate: async () => {
      throw new Error("must not download");
    },
    quitAndInstall: () => {
      throw new Error("must not install");
    },
  };
  const controller = new UpdateController({
    current: "0.7.7",
    unsupported: null,
    updater: () => updater,
    beforeInstall: async () => undefined,
    now: () => Date.parse("2026-11-22T10:00:00.000Z"),
    sleep: async () => undefined,
    log: (m) => logs.push(m),
  });
  return { controller, logs };
}

describe("the desktop updater without an update feed", () => {
  it.each(NO_FEED)("is quiet about: %s", async (message) => {
    expect(isMissingUpdateFile(message)).toBe(true);
    const { controller, logs } = controllerFailingWith(message);
    await expect(controller.run("check")).resolves.toBeUndefined();
    expect(controller.state).toMatchObject({
      phase: "idle",
      error: null,
      latest: "0.7.7",
      checkedAt: "2026-11-22T10:00:00.000Z",
    });
    // A download asked for anyway finds nothing to download.
    await expect(controller.run("download")).resolves.toBeUndefined();
    expect(controller.state.phase).toBe("idle");
    expect(logs.length).toBeGreaterThan(0);
  });

  it("still reports real failures", () => {
    expect(isMissingUpdateFile("sha512 checksum mismatch")).toBe(false);
  });

  it("packages the app to update from the channel's repository", async () => {
    // Non-literal specifiers: both files are plain JavaScript without type declarations.
    const file = "../electron-builder.config.mjs";
    const builderConfig = (await import(/* @vite-ignore */ file)).default as { publish: unknown };
    // The repository follows this checkout (its origin, or RELEASE_REPOSITORY), so a fork of
    // CodeHarden updates from its own releases; CodeHarden's own checkout resolves to itself.
    const define = new URL("../../../scripts/harden/channel-define.mjs", import.meta.url).href;
    const { readHardenChannel } = (await import(/* @vite-ignore */ define)) as {
      readHardenChannel: (
        env?: NodeJS.ProcessEnv,
        options?: { quiet?: boolean },
      ) => { owner: string; repo: string };
    };
    const { owner, repo } = readHardenChannel(process.env, { quiet: true });
    expect(builderConfig.publish).toEqual([
      { provider: "github", owner, repo, releaseType: "release" },
    ]);
    expect(`${owner}/${repo}`.toLowerCase()).not.toBe("leonvanzyl/codeden");
  });
});
