/**
 * The builder configuration reads the build's channel when it loads. Packing installers is a
 * release (scripts/package.mjs sets HARDEN_RELEASE_PACK first): in a fork that has not set
 * PACKAGE_NAME it must refuse, where a test or a `--dir` build that loads the same file only
 * gets the warning. The checkout's `origin` is scripted here; the rule itself is tested in
 * scripts/harden/channel-define.test.mjs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type BuilderConfig = { appId: string; publish: { owner: string; repo: string }[] };

/** Loads the configuration afresh, in a checkout whose `origin` is `remote`. */
async function loadConfig(remote: string, env: Record<string, string>): Promise<BuilderConfig> {
  vi.resetModules();
  vi.doMock("node:child_process", () => ({
    spawnSync: () => ({ status: 0, stdout: `${remote}\n` }),
  }));
  for (const name of ["PACKAGE_NAME", "RELEASE_REPOSITORY", "HARDEN_RELEASE_PACK"]) {
    vi.stubEnv(name, env[name] ?? "");
  }
  for (const name of ["PRODUCT_NAME", "APP_ID", "DEFAULT_PORT"]) vi.stubEnv(name, "");
  // A non-literal specifier: the config is plain JavaScript without type declarations.
  const file = "../electron-builder.config.mjs";
  return (await import(/* @vite-ignore */ file)).default;
}

const FORK = "https://github.com/example-org/example-fork.git";
const OWN = "https://github.com/harperaa/codeharden.git";
const PACK = { HARDEN_RELEASE_PACK: "1" };

afterEach(() => {
  vi.doUnmock("node:child_process");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("the builder configuration when installers are packed", () => {
  it("refuses a fork checkout that has not set PACKAGE_NAME", async () => {
    await expect(loadConfig(FORK, PACK)).rejects.toThrow(
      /PACKAGE_NAME is not set.*example-org\/example-fork.*setup-fork\.sh/,
    );
  });

  it("packs a fork that has set it, as the fork's own app", async () => {
    const config = await loadConfig(FORK, { ...PACK, PACKAGE_NAME: "example-harden" });
    expect(config.appId).toBe("com.exampleharden.app");
    expect(config.publish[0]).toMatchObject({ owner: "example-org", repo: "example-fork" });
  });

  it("changes nothing in CodeHarden's own checkout", async () => {
    const packed = await loadConfig(OWN, PACK);
    expect(packed.appId).toBe("com.codeharden.app");
    expect(packed.publish[0]).toMatchObject({ owner: "harperaa", repo: "codeharden" });
    expect(JSON.stringify(packed)).toBe(JSON.stringify(await loadConfig(OWN, {})));
  });

  it("only warns when a test or a --dir build loads it in a fork checkout", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = await loadConfig(FORK, {});
    expect(config.publish[0]).toMatchObject({ owner: "example-org", repo: "example-fork" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("PACKAGE_NAME");
  });
});
