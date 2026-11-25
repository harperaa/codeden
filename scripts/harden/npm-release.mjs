#!/usr/bin/env node
// The manual npm release of CodeHarden. A person runs it; nothing here runs in CI.
//
//   node scripts/harden/npm-release.mjs pack      build, stage, pack and check the tarball
//   node scripts/harden/npm-release.mjs login     sign in to npm in the browser (prints the URL to open)
//   node scripts/harden/npm-release.mjs publish   publish the packed tarball (asks npm, prints its URL)
//   node scripts/harden/npm-release.mjs status    what is packed, who is signed in, what is published
//
// The repository's `apps/cli/package.json` keeps upstream's name and version. `pack` copies the
// built package into a staging folder and writes the release manifest there: the channel's
// package name and command (`scripts/harden/channel-define.mjs`), and the root `VERSION` in its
// npm form (`2026.0105.0518` becomes `2026.105.518`; the git tag keeps the zeros). Nothing in
// the repository is modified. The tarball lands in `dist/npm/`, which git ignores.
//
// `publish` never runs by itself after `pack`, needs `--confirm <version>`, and always names the
// registry, so a stray npm config can't send the package elsewhere.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_HARDEN_BRANCH, readHardenChannel } from "./channel-define.mjs";
import {
  loginCommand,
  loginIntro,
  NPM_REGISTRY,
  notSignedInMessage,
  publishFailureMessage,
  signedInMessage,
} from "./npm-release-messages.mjs";
import { readHardenVersion } from "./version-define.mjs";

export { NPM_REGISTRY };

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CLI = join(ROOT, "apps", "cli");
const OUT = join(ROOT, "dist", "npm");
/** What the tarball must contain to be a working install. */
const REQUIRED_FILES = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/cli.js",
  "dist/runner.js",
  "dist/web/index.html",
  "dist/THIRD-PARTY-NOTICES.txt",
];

/** The npm form of a CodeHarden version: leading zeros stripped per field. */
export function npmVersion(hardenVersion) {
  const match = /^(\d{4})\.(\d{4})\.(\d{4})$/.exec(hardenVersion);
  if (!match) throw new Error(`"${hardenVersion}" is not a CodeHarden version (YYYY.MMDD.HHMM)`);
  return `${match[1]}.${Number(match[2])}.${Number(match[3])}`;
}

/** The package's command: its name without the scope. */
export function commandName(packageName) {
  return packageName.slice(packageName.lastIndexOf("/") + 1);
}

/** The tarball `npm pack` writes for a package: `codeharden-2026.105.518.tgz`. */
export function tarballName(packageName, version) {
  return `${packageName.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

/**
 * The published `package.json`, from the repository's: the channel's name and command, the
 * release version, links to the channel's repository, and nothing that only matters in the
 * workspace (dev dependencies, scripts; a `prepack` script must not run again at publish).
 */
export function releaseManifest(pkg, { hardenVersion, channel }) {
  const repository = `https://github.com/${channel.repository}`;
  const { devDependencies: _dev, scripts: _scripts, ...kept } = pkg;
  return {
    ...kept,
    name: channel.packageName,
    version: npmVersion(hardenVersion),
    repository: { type: "git", url: `git+${repository}.git`, directory: "apps/cli" },
    homepage: `${repository}#readme`,
    bugs: { url: `${repository}/issues` },
    bin: { [commandName(channel.packageName)]: "./dist/cli.js" },
  };
}

/** The README as npm shows it: relative links made absolute, into the channel's repository. */
export function releaseReadme(source, repository, branch = DEFAULT_HARDEN_BRANCH) {
  const absolute = (target) => {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) return target;
    const path = target.replace(/^\.\//, "");
    return /\.(?:png|jpe?g|gif|svg|webp)$/i.test(path)
      ? `https://raw.githubusercontent.com/${repository}/${branch}/${path}`
      : `https://github.com/${repository}/blob/${branch}/${path}`;
  };
  return source.replace(/\]\(([^)\s]+)\)/g, (_, target) => `](${absolute(target)})`);
}

/** Problems with an unpacked tarball (`dir` is its `package/` folder); empty when it is right. */
export function tarballProblems(dir, { hardenVersion, channel }) {
  const problems = [];
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return ["package.json is missing or unreadable"];
  }
  const version = npmVersion(hardenVersion);
  const command = commandName(channel.packageName);
  if (pkg.name !== channel.packageName)
    problems.push(`name is ${pkg.name}, not ${channel.packageName}`);
  if (pkg.version !== version) problems.push(`version is ${pkg.version}, not ${version}`);
  if (JSON.stringify(pkg.bin) !== JSON.stringify({ [command]: "./dist/cli.js" })) {
    problems.push(`bin is ${JSON.stringify(pkg.bin)}, not the ${command} command`);
  }
  if (!String(pkg.repository?.url ?? "").includes(`github.com/${channel.repository}.git`)) {
    problems.push(`repository does not point at ${channel.repository}`);
  }
  if (pkg.devDependencies || pkg.scripts) problems.push("workspace-only fields were not removed");
  for (const dep of Object.values(pkg.dependencies ?? {})) {
    if (String(dep).startsWith("workspace:")) problems.push("a workspace: dependency is left");
  }
  for (const file of REQUIRED_FILES) {
    if (!existsSync(join(dir, file))) problems.push(`${file} is missing`);
  }
  for (const extra of ["src", "test", "node_modules", "tsconfig.json"]) {
    if (existsSync(join(dir, extra))) problems.push(`${extra} must not be in the package`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------

function fail(message) {
  console.error(`\nnpm release: ${message}`);
  process.exit(1);
}

/** Run a command and return its trimmed stdout, or null when it failed. */
function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Run a command attached to this terminal (npm prints the URL to open, and waits for it). */
function attached(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  return result.status ?? 1;
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const shell = process.platform === "win32";

function release() {
  // Strict: outside CodeHarden's own repository there is no default package name.
  let channel;
  try {
    channel = readHardenChannel(process.env, { strict: true });
  } catch (error) {
    fail(error.message);
  }
  const hardenVersion = readHardenVersion();
  const version = npmVersion(hardenVersion);
  const tarball = join(OUT, tarballName(channel.packageName, version));
  return { channel, hardenVersion, version, tag: `v${hardenVersion}`, tarball };
}

/** The tree must be what the tag names: the tarball and the GitHub release then match. */
function checkCheckout({ tag }, flags) {
  const dirty = capture("git", ["status", "--porcelain"], { cwd: ROOT });
  if (dirty === null) fail("this is not a git checkout");
  if (dirty && !flags["allow-dirty"]) {
    fail(
      `the working tree has changes:\n${dirty}\nCommit or discard them (or pass --allow-dirty to rehearse).`,
    );
  }
  const head = capture("git", ["rev-parse", "HEAD"], { cwd: ROOT });
  const tagged = capture("git", ["rev-parse", "--verify", "--quiet", `${tag}^{commit}`], {
    cwd: ROOT,
  });
  if (tagged !== head && !flags["allow-untagged"]) {
    fail(
      tagged
        ? `HEAD is not the release ${tag}. Check the release out first: git checkout ${tag}`
        : `the tag ${tag} is not in this checkout. Fetch it: git fetch origin tag ${tag}`,
    );
  }
  return { head, atTag: tagged === head, dirty: Boolean(dirty) };
}

function pack(flags) {
  const rel = release();
  const checkout = checkCheckout(rel, flags);
  console.log(
    `Packing ${rel.channel.packageName}@${rel.version} (CodeHarden ${rel.hardenVersion})`,
  );
  if (!flags["skip-build"]) {
    console.log("\nBuilding (pnpm install --frozen-lockfile, pnpm build) ...");
    if (attached(pnpm, ["install", "--frozen-lockfile"], { cwd: ROOT, shell }) !== 0)
      fail("pnpm install failed");
    if (attached(pnpm, ["build"], { cwd: ROOT, shell }) !== 0) fail("pnpm build failed");
  }
  if (!existsSync(join(CLI, "dist", "cli.js")))
    fail("apps/cli/dist is missing: run without --skip-build");

  const stage = mkdtempSync(join(tmpdir(), "codeharden-npm-"));
  try {
    cpSync(join(CLI, "dist"), join(stage, "dist"), { recursive: true });
    cpSync(join(CLI, "LICENSE"), join(stage, "LICENSE"));
    const pkg = JSON.parse(readFileSync(join(CLI, "package.json"), "utf8"));
    const manifest = releaseManifest(pkg, rel);
    writeFileSync(join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    writeFileSync(
      join(stage, "README.md"),
      releaseReadme(readme, rel.channel.repository, rel.channel.branch),
    );

    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    const packed = capture(npm, ["pack", "--pack-destination", OUT, "--ignore-scripts"], {
      cwd: stage,
      shell,
    });
    if (packed === null || !existsSync(rel.tarball)) fail("npm pack failed");
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }

  check(rel);
  writeFileSync(
    join(OUT, "release.json"),
    `${JSON.stringify({ name: rel.channel.packageName, version: rel.version, hardenVersion: rel.hardenVersion, tag: rel.tag, commit: checkout.head, rehearsal: !checkout.atTag || checkout.dirty }, null, 2)}\n`,
  );
  console.log(`\nPacked and checked: ${rel.tarball}`);
  if (!checkout.atTag || checkout.dirty) {
    console.log(
      "This is a rehearsal (not a clean checkout of the release tag): publish refuses it.",
    );
  } else {
    console.log("Next: scripts/harden/publish.sh (run by the owner, in their own terminal)");
  }
}

/** Unpack the tarball and check its manifest, its files and that its CLI starts. */
function check(rel) {
  const dir = mkdtempSync(join(tmpdir(), "codeharden-npm-check-"));
  try {
    if (attached("tar", ["-xzf", rel.tarball, "-C", dir]) !== 0)
      fail("could not unpack the tarball");
    const root = join(dir, "package");
    const problems = tarballProblems(root, rel);
    // The Claude Agent SDK is installed on demand and must never be shipped.
    const notices = readFileSync(join(root, "dist", "THIRD-PARTY-NOTICES.txt"), "utf8");
    if (notices.includes("claude-agent-sdk@")) problems.push("the Claude Agent SDK is bundled");
    const env = { ...process.env, CODEDEN_NO_SWITCH: "1" };
    const reported = capture(process.execPath, [join(root, "dist", "cli.js"), "--version"], {
      env,
    });
    const line = capture(process.execPath, [join(root, "dist", "cli.js"), "--version"]) ?? "";
    if (!line.startsWith(`CodeHarden ${rel.hardenVersion} `)) {
      problems.push(
        `the packed CLI's version line is "${line}", not CodeHarden ${rel.hardenVersion}`,
      );
    }
    if (reported !== rel.version)
      problems.push(`the packed CLI reports "${reported}", not ${rel.version}`);
    const chunks = readdirSync(join(root, "dist")).filter((f) => f.endsWith(".js"));
    const built = chunks.map((f) => readFileSync(join(root, "dist", f), "utf8")).join("\n");
    if (!built.includes(JSON.stringify(rel.channel.packageName))) {
      problems.push(`the bundle was not built for the package ${rel.channel.packageName}`);
    }
    if (!built.includes(JSON.stringify(rel.hardenVersion))) {
      problems.push(`the bundle was not built from VERSION ${rel.hardenVersion}`);
    }
    if (problems.length > 0) fail(`the tarball is not right:\n- ${problems.join("\n- ")}`);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) =>
      e.isFile(),
    );
    console.log("\nTarball checks passed.");
    console.log(`  name:     ${pkg.name}`);
    console.log(`  version:  ${pkg.version} (CodeHarden ${rel.hardenVersion}, tag ${rel.tag})`);
    console.log(
      `  bin:      ${Object.entries(pkg.bin)
        .map(([k, v]) => `${k} -> ${v}`)
        .join(", ")}`,
    );
    console.log(`  files:    ${files.length}`);
    console.log(`  reports:  ${line}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function registryOf(flags) {
  return (flags.registry ?? NPM_REGISTRY).replace(/\/+$/, "");
}

function whoami(registry) {
  return capture(npm, ["whoami", "--registry", registry], { shell });
}

function login(flags) {
  const registry = registryOf(flags);
  console.log(`${loginIntro(registry)}\n`);
  // `--auth-type=web` makes npm print the sign-in URL instead of asking for a password here. npm
  // falls back to asking for a user name and password when the registry has no web sign-in.
  const code = attached(npm, ["login", "--auth-type=web", "--registry", registry], { shell });
  if (code !== 0) fail("npm login did not finish: nobody was signed in");
  const user = whoami(registry);
  if (!user) fail("npm login finished, but npm whoami still shows nobody. Don't publish.");
  console.log(`\n${signedInMessage(user, registry)}`);
}

function publishedVersions(name, registry) {
  const out = capture(npm, ["view", name, "versions", "--json", "--registry", registry], { shell });
  if (out === null) return [];
  const parsed = JSON.parse(out || "[]");
  return Array.isArray(parsed) ? parsed : [parsed];
}

function status(flags) {
  const rel = release();
  const registry = registryOf(flags);
  const published = publishedVersions(rel.channel.packageName, registry);
  console.log(`Package:    ${rel.channel.packageName}`);
  console.log(`VERSION:    ${rel.hardenVersion} (npm ${rel.version}, tag ${rel.tag})`);
  console.log(`Tarball:    ${existsSync(rel.tarball) ? rel.tarball : "not packed yet"}`);
  console.log(`Registry:   ${registry}`);
  console.log(`Signed in:  ${whoami(registry) ?? `no (sign in: ${loginCommand(registry)})`}`);
  console.log(
    `Published:  ${published.length === 0 ? "nothing yet" : published.slice(-5).join(", ")}`,
  );
  console.log(
    `This one:   ${published.includes(rel.version) ? "already published" : "not published"}`,
  );
}

function publish(flags) {
  const rel = release();
  const registry = registryOf(flags);
  const dry = Boolean(flags["dry-run"]);
  if (!existsSync(rel.tarball)) fail(`no tarball for ${rel.version}: run pack first`);
  let info = {};
  try {
    info = JSON.parse(readFileSync(join(OUT, "release.json"), "utf8"));
  } catch {
    fail("dist/npm/release.json is missing: run pack again");
  }
  if (info.version !== rel.version) fail("the tarball is from another version: run pack again");
  if (info.rehearsal && !dry)
    fail("the tarball is a rehearsal (not packed from a clean checkout of the release tag)");
  if (info.commit !== capture("git", ["rev-parse", "HEAD"], { cwd: ROOT }) && !dry) {
    fail("the checkout moved since pack: run pack again");
  }
  check(rel);
  if (!dry && flags.confirm !== rel.version) {
    fail(
      `publishing is final: a version can never be published twice.\nTo publish ${rel.channel.packageName}@${rel.version}, pass --confirm ${rel.version}`,
    );
  }
  if (publishedVersions(rel.channel.packageName, registry).includes(rel.version)) {
    fail(`${rel.channel.packageName}@${rel.version} is already published`);
  }
  if (!dry) {
    const user = whoami(registry);
    if (!user) fail(notSignedInMessage(registry));
    console.log(
      `\nPublishing ${rel.channel.packageName}@${rel.version} to ${registry} as ${user}.`,
    );
    console.log(
      "npm asks you to authenticate in the browser: it prints a URL, open it and approve.\n",
    );
  }
  const args = [
    "publish",
    rel.tarball,
    "--access",
    "public",
    "--registry",
    registry,
    "--ignore-scripts",
  ];
  if (dry) args.push("--dry-run");
  if (attached(npm, args, { cwd: OUT, shell }) !== 0) {
    if (dry) fail("the dry run failed");
    // The sign-in may have expired since the check above, or have no rights on the package.
    fail(
      publishFailureMessage({
        packageName: rel.channel.packageName,
        version: rel.version,
        registry,
        user: whoami(registry),
        published: publishedVersions(rel.channel.packageName, registry).includes(rel.version),
      }),
    );
  }
  if (dry) {
    console.log("\nDry run only: nothing was published.");
    return;
  }
  const command = commandName(rel.channel.packageName);
  console.log(`\nPublished ${rel.channel.packageName}@${rel.version}.`);
  console.log(`Check it:  npm view ${rel.channel.packageName} version`);
  console.log(
    `Try it:    npx ${rel.channel.packageName}@${rel.version} --version   (the command is ${command})`,
  );
}

const USAGE = `Usage: node scripts/harden/npm-release.mjs <pack|login|publish|status> [options]

  pack      --skip-build       pack the existing apps/cli/dist
            --allow-dirty      rehearse with uncommitted changes
            --allow-untagged   rehearse when HEAD is not the release tag
  login                        sign in to npm in the browser (npm login --auth-type=web)
  publish   --dry-run          show what npm would publish, publish nothing
            --confirm <ver>    required to publish for real
  status                       what is packed, who is signed in, what is published

  --registry <url>             another registry (tests only; default ${NPM_REGISTRY})
`;

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "skip-build": { type: "boolean" },
      "allow-dirty": { type: "boolean" },
      "allow-untagged": { type: "boolean" },
      "dry-run": { type: "boolean" },
      confirm: { type: "string" },
      registry: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = positionals[0];
  if (values.help || !command) return void console.log(USAGE);
  if (command === "pack") return pack(values);
  if (command === "login") return login(values);
  if (command === "publish") return publish(values);
  if (command === "status") return status(values);
  fail(`unknown command "${command}"\n\n${USAGE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
