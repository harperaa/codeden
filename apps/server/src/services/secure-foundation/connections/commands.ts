import {
  type ConvexTeam,
  ConvexTeamSlug,
  HARDEN_APP_SLUG,
  SECURE_FOUNDATION_GITHUB_SCOPES,
  SECURE_FOUNDATION_NPX_PACKAGES,
  type SecureFoundationService,
  secureFoundationInstallHint,
} from "@codeden/contracts";
import type { CliResult } from "./process";

/**
 * The fixed commands of the sign-in checks: per service, one that asks its CLI whether this
 * computer is signed in and one that starts its login. Every word is written here: nothing
 * comes from the form, a request or the template. Flags and output formats were read from each
 * CLI's own source and documentation.
 */

export interface Command {
  program: string;
  args: readonly string[];
}

export interface StatusReading {
  signedIn: boolean | null;
  teams: ConvexTeam[];
  account?: string | null;
  owners?: string[];
  missingScopes?: string[];
  scopes?: Array<{ slug: string; name: string }>;
}

export interface ServiceCommands {
  /** The name people know the service by. */
  label: string;
  status: Command;
  login: Command;
  /** A second question asked once signed in (GitHub's organisations, Vercel's teams). */
  extra?: Command;
  /** Signed in, but short of a permission: the command that adds it instead of a new login. */
  refresh?: Command;
  /** How long the status command may take (npx may have to download the pinned package). */
  statusTimeoutMs: number;
  readStatus(result: CliResult, extra: CliResult | null): StatusReading;
  /** The sign-in link and code in what the login has printed so far. */
  readLogin(output: string): { url: string | null; code: string | null };
  /** Said when the program can't be found on the app's path. */
  missing: string;
  /** For a missing CLI: what the person runs to install it themselves. */
  install: string | null;
  /** What to do by hand when the login can't be driven from here. */
  manual: string;
}

/** The first link in `output` that is on one of the service's own hosts. */
function linkOn(output: string, domain: string): string | null {
  for (const word of output.split(/\s/)) {
    if (!word.startsWith("https://") || word.length > 2_000) continue;
    let text = word;
    while (/[.,)]$/.test(text)) text = text.slice(0, -1);
    try {
      const host = new URL(text).hostname.toLowerCase();
      if (host === domain || host.endsWith(`.${domain}`)) return text;
    } catch {
      // Not a URL after all.
    }
  }
  return null;
}

/** The word that follows `marker` in `output` (a sign-in code), or null. */
function wordAfter(output: string, marker: string): string | null {
  const at = output.indexOf(marker);
  if (at < 0) return null;
  const word = output
    .slice(at + marker.length, at + marker.length + 200)
    .trim()
    .split(/\s/, 1)[0];
  return word && /^[A-Za-z0-9_-]{4,80}$/.test(word) ? word : null;
}

/** The JSON object in `output`, which may have other lines around it; null when there is none. */
function jsonIn(output: string): Record<string, unknown> | null {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(output.slice(start, end + 1));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const names = (lines: string[]) => lines.map((l) => l.trim()).filter((l) => NAME.test(l));

/** `gh auth status --json hosts`: the active github.com account and its permissions. */
function githubStatus(result: CliResult, extra: CliResult | null): StatusReading {
  const none = { signedIn: null, teams: [] };
  const hosts = jsonIn(result.output)?.hosts;
  if (!hosts || typeof hosts !== "object")
    return result.code === null ? none : { ...none, signedIn: false };
  const entries = (hosts as Record<string, unknown>)["github.com"];
  const active = (Array.isArray(entries) ? entries : []).find(
    (e) => e && typeof e === "object" && e.active === true && e.state === "success",
  ) as { login?: unknown; scopes?: unknown } | undefined;
  if (!active || typeof active.login !== "string") return { signedIn: false, teams: [] };
  const raw = Array.isArray(active.scopes) ? active.scopes.join(",") : String(active.scopes ?? "");
  const granted = raw.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
  return {
    signedIn: true,
    teams: [],
    account: active.login,
    owners: names([active.login, ...(extra?.code === 0 ? extra.output.split("\n") : [])]),
    missingScopes: SECURE_FOUNDATION_GITHUB_SCOPES.filter((s) => !granted.includes(s)),
  };
}

const vercelNpx = ["--yes", SECURE_FOUNDATION_NPX_PACKAGES.vercel] as const;

/** `vercel whoami --json`, and `vercel teams list --json` for the scopes. */
function vercelStatus(result: CliResult, extra: CliResult | null): StatusReading {
  const who = jsonIn(result.output);
  if (!who || who.loggedIn === false || typeof who.username !== "string") {
    return { signedIn: result.code === 1 || who?.loggedIn === false ? false : null, teams: [] };
  }
  const listed = extra?.code === 0 ? jsonIn(extra.output)?.teams : who.teams;
  const scopes = (Array.isArray(listed) ? listed : []).flatMap((t) =>
    t && typeof t.slug === "string" && NAME.test(t.slug)
      ? [{ slug: t.slug, name: typeof t.name === "string" ? t.name.slice(0, 200) : t.slug }]
      : [],
  );
  return { signedIn: true, teams: [], account: who.username.slice(0, 200), scopes };
}

/** Vercel prints its sign-in page with or without `https://` in front. */
function vercelLink(output: string): string | null {
  const full = linkOn(output, "vercel.com");
  if (full) return full;
  const bare = output.split(/\s/).find((w) => w.startsWith("vercel.com/") && w.length < 2_000);
  return bare ? `https://${bare}` : null;
}

const convexNpx = ["--yes", SECURE_FOUNDATION_NPX_PACKAGES.convex] as const;

/** `convex login status` lists teams as ` - Name (slug)` under "Status: Logged in". */
function convexTeams(output: string): ConvexTeam[] {
  const teams: ConvexTeam[] = [];
  for (const raw of output.split("\n").slice(0, 500)) {
    const line = raw.trim();
    if (line.length > 300 || !line.startsWith("- ") || !line.endsWith(")")) continue;
    const open = line.lastIndexOf(" (");
    if (open < 2) continue;
    const name = line.slice(2, open).trim();
    const slug = line.slice(open + 2, -1);
    if (name && ConvexTeamSlug.safeParse(slug).success) teams.push({ name, slug });
  }
  return teams;
}

const clerkNpx = ["--yes", SECURE_FOUNDATION_NPX_PACKAGES.clerk] as const;

/**
 * `clerk whoami --json`: one JSON object with the account's `email` when signed in; without a
 * session it fails with "Not logged in" or "Session expired" (error code `auth_required`).
 * Only yes, no or unknown is read: the email goes no further than this function. Anything else
 * (another failure, output that isn't that object) is unknown, never signed out.
 */
export function clerkStatus({ code, output }: CliResult): StatusReading {
  const unknown = { signedIn: null, teams: [] };
  if (code === null) return unknown;
  if (code === 0) {
    const email = jsonIn(output)?.email;
    return typeof email === "string" && email.length > 0 ? { signedIn: true, teams: [] } : unknown;
  }
  return /Not logged in|Session expired|auth_required/.test(output)
    ? { signedIn: false, teams: [] }
    : unknown;
}

export const SERVICE_COMMANDS: Record<SecureFoundationService, ServiceCommands> = {
  clerk: {
    label: "Clerk",
    status: { program: "npx", args: [...clerkNpx, "whoami", "--json"] },
    // Prints its sign-in page, opens the browser itself and waits for the browser to come back
    // to this computer. Without a terminal it asks nothing.
    login: { program: "npx", args: [...clerkNpx, "auth", "login"] },
    statusTimeoutMs: 120_000,
    readStatus: clerkStatus,
    readLogin: (output) => ({ url: linkOn(output, "clerk.com"), code: null }),
    missing:
      "Node.js (npx) isn't on the app's path, so Clerk can't be asked. Install Node.js, or start the app from a terminal where `npx` works, then check again.",
    install: null,
    manual: "Run `npx clerk auth login` in a terminal, then check again.",
  },
  convex: {
    label: "Convex",
    // Exits 1 with "Status: Not logged in" when signed out.
    status: { program: "npx", args: [...convexNpx, "login", "status"] },
    // The login the template's install uses: prints a link and waits; opens no browser itself.
    login: {
      program: "npx",
      args: [
        ...convexNpx,
        "login",
        "--login-flow",
        "poll",
        "--no-open",
        "--device-name",
        `${HARDEN_APP_SLUG}-setup`,
      ],
    },
    statusTimeoutMs: 120_000,
    readStatus({ code, output }) {
      if (/Status:\s+Logged in/.test(output)) return { signedIn: true, teams: convexTeams(output) };
      if (/Status:\s+Not logged in/.test(output) || code === 1)
        return { signedIn: false, teams: [] };
      return { signedIn: null, teams: [] };
    },
    readLogin: (output) => ({
      url: linkOn(output, "convex.dev"),
      code: wordAfter(output, "minutes:"),
    }),
    missing:
      "Node.js (npx) isn't on the app's path, so Convex can't be asked. Install Node.js, or start the app from a terminal where `npx` works, then check again.",
    install: null,
    manual: "Run `npx convex login` in a terminal, then check again.",
  },
  doppler: {
    label: "Doppler",
    status: { program: "doppler", args: ["me", "--json"] },
    // `--yes` skips its "open the browser?" question (it opens the page itself); `--no-copy`
    // leaves the clipboard alone. It gives up by itself after five minutes.
    login: { program: "doppler", args: ["login", "--yes", "--no-copy"] },
    statusTimeoutMs: 20_000,
    readStatus: ({ code }) => ({ signedIn: code === null ? null : code === 0, teams: [] }),
    readLogin: (output) => ({
      url: linkOn(output, "doppler.com"),
      code: wordAfter(output, "code is:"),
    }),
    missing: "The Doppler command-line tool isn't installed, or isn't on the app's path.",
    install: secureFoundationInstallHint("doppler", process.platform),
    manual: "Run `doppler login` in a terminal, then check again.",
  },
  github: {
    label: "GitHub",
    // With `--json` it exits 0 whatever the state, and never prints a token.
    status: { program: "gh", args: ["auth", "status", "--json", "hosts"] },
    extra: { program: "gh", args: ["api", "user/orgs", "--jq", ".[].login"] },
    // Without a terminal it prints a one-time code and the device page, and opens no browser.
    login: {
      program: "gh",
      args: [
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--web",
        "--scopes",
        "workflow",
      ],
    },
    refresh: {
      program: "gh",
      args: ["auth", "refresh", "--hostname", "github.com", "--scopes", "workflow"],
    },
    statusTimeoutMs: 20_000,
    readStatus: githubStatus,
    readLogin: (output) => ({
      url: linkOn(output, "github.com"),
      code: wordAfter(output, "one-time code:"),
    }),
    missing: "The GitHub command-line tool (gh) isn't installed, or isn't on the app's path.",
    install: secureFoundationInstallHint("gh", process.platform),
    manual: "Run `gh auth login -h github.com -s workflow` in a terminal, then check again.",
  },
  vercel: {
    label: "Vercel",
    // Exits 1 with `{"loggedIn": false}` when signed out.
    status: { program: "npx", args: [...vercelNpx, "whoami", "--json"] },
    extra: { program: "npx", args: [...vercelNpx, "teams", "list", "--json"] },
    // Opens the browser itself and prints the device page.
    login: { program: "npx", args: [...vercelNpx, "login"] },
    statusTimeoutMs: 120_000,
    readStatus: vercelStatus,
    readLogin: (output) => ({ url: vercelLink(output), code: wordAfter(output, "and enter") }),
    missing:
      "Node.js (npx) isn't on the app's path, so Vercel can't be asked. Install Node.js, or start the app from a terminal where `npx` works, then check again.",
    install: null,
    manual: "Run `npx vercel login` in a terminal, then check again.",
  },
};
