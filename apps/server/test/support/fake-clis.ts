import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

/**
 * Fake `npx` (for the pinned Convex and Vercel packages), `doppler` and `gh` on a PATH of their own, for the
 * Connections step. They sign in to nothing: a `mode` file says how they behave, and they take
 * exactly the arguments the product's fixed commands pass, exiting 64 on anything else.
 * POSIX only (a script with a `#!` line).
 */

export type FakeMode = "signed_out" | "signed_in" | "login_ok" | "login_hang" | "login_fail";

const SCRIPT = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const dir = __dirname;
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2).join(" ");
const file = (f) => path.join(dir, f);
const read = (f, fallback) => (fs.existsSync(file(f)) ? fs.readFileSync(file(f), "utf8") : fallback);
const mode = read("mode", "signed_out").trim();
// One fake npx serves two pinned packages.
const tool = name !== "npx" ? name : args.includes("vercel@") ? "vercel" : "convex";
fs.writeFileSync(file(name + ".env.json"), JSON.stringify({ env: Object.keys(process.env), cwd: process.cwd(), args }));
fs.appendFileSync(file("calls.log"), name + " " + args + "\\n");
const KNOWN = {
  convex: { status: "--yes convex@1.43.0 login status", login: "--yes convex@1.43.0 login --login-flow poll --no-open --device-name codeharden-setup" },
  doppler: { status: "me --json", login: "login --yes --no-copy" },
  gh: { status: "auth status --json hosts", extra: "api user/orgs --jq .[].login", login: "auth login --hostname github.com --git-protocol https --web --scopes workflow", refresh: "auth refresh --hostname github.com --scopes workflow" },
  vercel: { status: "--yes vercel@66.6.0 whoami --json", extra: "--yes vercel@66.6.0 teams list --json", login: "--yes vercel@66.6.0 login" },
}[tool];
const signedIn = () => fs.existsSync(file(tool + ".signed-in")) || mode === "signed_in";
const say = (text) => console.log(text);
if (args === KNOWN.status) {
  if (tool === "gh") {
    const scopes = read("gh.scopes", "gist, read:org, repo, workflow").trim();
    say(JSON.stringify({ hosts: signedIn() ? { "github.com": [{ state: "success", active: true, host: "github.com", login: "demo-person", scopes }] } : {} }));
    process.exit(0);
  }
  if (!signedIn()) {
    say({ convex: "Status: Not logged in", doppler: "Doppler Error: you must provide a token", vercel: JSON.stringify({ loggedIn: false }) }[tool]);
    process.exit(1);
  }
  if (tool === "convex") say("Account: default\\nStatus: Logged in\\nTeams: 2 teams accessible\\n - Acme Labs (acme-labs)\\n - Side Project (side-project)\\n - Broken (not a slug)");
  else if (tool === "vercel") say("npm notice something\\n" + JSON.stringify({ username: "demo-person", teams: null }));
  else say(JSON.stringify({ workplace: { name: "Acme" } }));
  process.exit(0);
}
if (args === KNOWN.extra) {
  if (tool === "gh") say(read("gh.orgs", "acme-org\\nside-org\\n"));
  else say(read("vercel.teams", JSON.stringify({ teams: [{ id: "t1", slug: "acme-team", name: "Acme Team", current: true }, { id: "t2", slug: "side-team", name: "Side Team", current: false }] })));
  process.exit(0);
}
if (args !== KNOWN.login && args !== KNOWN.refresh) { console.error("unexpected arguments: " + args); process.exit(64); }
if (mode === "login_fail") { console.error("something went wrong"); process.exit(1); }
fs.writeFileSync(file(name + ".pid"), String(process.pid));
if (tool === "convex") say("Visit https://auth.convex.dev/activate?user_code=WXYZ-1234 to finish logging in.\\nYou should see the following code which expires in 5 minutes: WXYZ-1234");
else if (tool === "doppler") say("Complete authorization at https://dashboard.doppler.com/workplace/auth/cli\\nYour auth code is:\\n\\u001b[32mfake_code_1234\\u001b[0m\\nWaiting...");
else if (tool === "gh") console.error("! First copy your one-time code: ABCD-1234\\nOpen this URL to continue in your web browser: https://github.com/login/device");
else say("Visit vercel.com/oauth/device?user_code=VRCL-9876 and enter VRCL-9876");
setInterval(() => {
  if (mode === "login_ok" && fs.existsSync(file("approve"))) {
    fs.writeFileSync(file(tool + ".signed-in"), "");
    if (args === KNOWN.refresh) fs.writeFileSync(file("gh.scopes"), "gist, read:org, repo, workflow");
    process.exit(0);
  }
}, 20);
`;

export interface FakeClis {
  dir: string;
  /** The environment to hand the service: the fakes first on PATH, plus things that must not leak. */
  env: NodeJS.ProcessEnv;
  setMode(mode: FakeMode): void;
  /** The person finishing the sign-in in their browser. */
  approve(): void;
  /** What a fake last saw: its argument line, working directory and environment variable names. */
  seen(name: FakeName): { env: string[]; cwd: string; args: string } | null;
  /** The process id of a fake's running login, or null. */
  pid(name: FakeName): number | null;
  /** Write one of the fakes' state files (`gh.scopes`, `gh.orgs`, `vercel.teams`, `<tool>.signed-in`). */
  write(file: string, text: string): void;
  /** Every command line the fakes were run with, in order. */
  calls(): string[];
}

export type FakeName = "npx" | "doppler" | "gh";

const ALL: FakeName[] = ["npx", "doppler", "gh"];

/**
 * The folders the fakes need besides their own: Node's and the system's. A CLI that is left
 * out must be missing whatever the machine has installed (a Linux CI runner has a real `gh` in
 * `/usr/bin`, a Mac may have one beside Node), so with `missing` names the folders are copied
 * as links into `dir`, without those names. No real CLI is ever started by a test.
 */
function systemFolders(dir: string, missing: FakeName[]): string[] {
  const folders = [dirname(process.execPath), "/usr/bin", "/bin"];
  if (missing.length === 0) return folders;
  return folders.map((folder, index) => {
    const copy = join(dir, `system-${index}`);
    mkdirSync(copy);
    for (const name of existsSync(folder) ? readdirSync(folder) : []) {
      if (!(missing as string[]).includes(name)) symlinkSync(join(folder, name), join(copy, name));
    }
    return copy;
  });
}

export function makeFakeClis(only: FakeName[] = ["npx", "doppler", "gh"]): FakeClis {
  const dir = mkdtempSync(join(tmpdir(), "fake-clis-"));
  for (const name of only) {
    writeFileSync(join(dir, name), SCRIPT);
    chmodSync(join(dir, name), 0o755);
  }
  writeFileSync(join(dir, "mode"), "signed_out");
  const read = (file: string) =>
    existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : null;
  return {
    dir,
    env: {
      PATH: [
        dir,
        ...systemFolders(
          dir,
          ALL.filter((name) => !only.includes(name)),
        ),
      ].join(delimiter),
      HOME: dir,
      SECRET_FROM_THE_SERVER: "must-not-reach-a-cli",
      CODEDEN_HOME: "/nowhere",
    },
    setMode: (mode) => writeFileSync(join(dir, "mode"), mode),
    approve: () => writeFileSync(join(dir, "approve"), ""),
    seen(name) {
      const text = read(`${name}.env.json`);
      return text ? (JSON.parse(text) as { env: string[]; cwd: string; args: string }) : null;
    },
    write: (file, text) => writeFileSync(join(dir, file), text),
    calls: () => (read("calls.log") ?? "").split("\n").filter(Boolean),
    pid(name) {
      const text = read(`${name}.pid`);
      return text ? Number(text) : null;
    },
  };
}

/** True while a process exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
