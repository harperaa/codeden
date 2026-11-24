import {
  SECURE_FOUNDATION_TOOLS,
  type SecureFoundationConnection,
  type SecureFoundationRequirements,
  type SecureFoundationService,
  type SecureFoundationToolCheck,
  type SecureFoundationToolRequirement,
  secureFoundationPlatform,
} from "@codeden/contracts";
import { parseVersion } from "../setup/parse";
import type { Command } from "./connections/commands";
import type { CliResult } from "./connections/process";

/**
 * The requirements page's check: every tool of `SECURE_FOUNDATION_TOOLS`, asked on this
 * computer. A tool's version is its own `--version`; a service's sign-in is what the sign-in
 * checks of Go answer (`ConnectionsService.states`, the same fixed commands). Read-only: it
 * installs nothing, signs in to nothing and writes nothing. Of what a CLI prints only the
 * version number leaves this file; of a sign-in only yes, no or unknown.
 */

export interface RequirementsDeps {
  /** Run fixed commands without a shell, in a folder that isn't a project. */
  runAll(commands: readonly Command[], timeoutMs: number): Promise<CliResult[]>;
  /** The sign-in checks Go makes. */
  states(services: SecureFoundationService[]): Promise<SecureFoundationConnection[]>;
  platform?: NodeJS.Platform;
  now?: () => Date;
}

/** How long a `--version` may take. */
export const VERSION_TIMEOUT_MS = 10_000;

type Check = Omit<SecureFoundationToolCheck, "id">;
const VERSION = /^[\w.+-]{1,40}$/;

/** A tool's own `--version` answer. */
export function readVersion(
  tool: SecureFoundationToolRequirement,
  result: CliResult | null,
): Check {
  const none = { version: null, signedIn: null };
  if (!result || result.timedOut || (result.code !== 0 && !result.notFound)) {
    return {
      ...none,
      state: "unknown",
      found: null,
      message: `${tool.label} couldn't be checked${result?.timedOut ? " (it took too long)" : ""}.`,
    };
  }
  if (result.notFound) {
    return {
      ...none,
      state: "missing",
      found: false,
      message: `${tool.label} isn't installed, or isn't on the app's path.`,
    };
  }
  const parsed = parseVersion(result.output.slice(0, 2_000));
  const version = parsed && VERSION.test(parsed) ? parsed : null;
  const major = version ? Number.parseInt(version, 10) : Number.NaN;
  if (tool.minMajor && major < tool.minMajor) {
    return {
      state: "outdated",
      found: true,
      version,
      signedIn: null,
      message: `${tool.label} ${version} is older than version ${tool.minMajor}, the oldest the install accepts.`,
    };
  }
  return { state: "ok", found: true, version, signedIn: null, message: "Installed." };
}

/** The pinned version of an `npx` package (`convex@1.43.0`). */
const pinned = (pkg: string | undefined) => {
  const version = pkg?.slice(pkg.lastIndexOf("@") + 1) ?? "";
  return VERSION.test(version) ? version : null;
};

/** A tool that holds a service's sign-in: its version answer and the sign-in check together. */
export function readSignIn(
  tool: SecureFoundationToolRequirement,
  installed: Check | null,
  connection: SecureFoundationConnection | null,
): Check {
  const version = installed?.version ?? pinned(tool.npxPackage);
  if (connection?.cli === "missing" || installed?.state === "missing") {
    return {
      state: "missing",
      found: false,
      version: null,
      signedIn: null,
      message: tool.npxPackage
        ? `Needs Node.js: ${tool.label} runs through npx, which wasn't found on the app's path.`
        : `${tool.label} isn't installed, or isn't on the app's path.`,
    };
  }
  if (!connection || connection.signedIn === null) {
    return {
      state: "unknown",
      found: installed?.found ?? (connection ? true : null),
      version,
      signedIn: null,
      message: `${tool.label}'s sign-in couldn't be checked.`,
    };
  }
  const found = { found: true, version, signedIn: connection.signedIn };
  if (!connection.signedIn) {
    return { ...found, state: "needs_sign_in", message: "Not signed in on this computer." };
  }
  if (connection.missingScopes.length > 0) {
    return {
      ...found,
      state: "needs_permission",
      // Permission names only (`workflow`), as the sign-in check words it.
      message: `Signed in, but without the ${connection.missingScopes.join(", ").slice(0, 100)} permission the deploy needs.`,
    };
  }
  return { ...found, state: "ok", message: "Signed in on this computer." };
}

/** Check every tool, whether or not another one failed. A check that throws reads as unknown. */
export async function checkRequirements(
  deps: RequirementsDeps,
): Promise<SecureFoundationRequirements> {
  const versioned = SECURE_FOUNDATION_TOOLS.filter((t) => t.program !== null);
  const services = SECURE_FOUNDATION_TOOLS.flatMap((t) => (t.service ? [t.service] : []));
  const [versions, connections] = await Promise.all([
    deps
      .runAll(
        versioned.map((t) => ({ program: t.program as string, args: ["--version"] })),
        VERSION_TIMEOUT_MS,
      )
      .catch((): CliResult[] => []),
    deps.states(services).catch((): SecureFoundationConnection[] => []),
  ]);
  const tools = SECURE_FOUNDATION_TOOLS.map((tool) => {
    const at = versioned.indexOf(tool);
    const installed = at < 0 ? null : readVersion(tool, versions[at] ?? null);
    if (!tool.service) return { id: tool.id, ...(installed as Check) };
    const connection = connections.find((c) => c.service === tool.service) ?? null;
    return { id: tool.id, ...readSignIn(tool, installed, connection) };
  });
  return {
    checkedAt: (deps.now?.() ?? new Date()).toISOString(),
    platform: secureFoundationPlatform(deps.platform ?? process.platform),
    tools,
  };
}
