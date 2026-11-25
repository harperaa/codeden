// Keeps the fork's changes through upstream merges ("Keeping the fork's changes through
// upstream merges" in AGENTS.md). Two checks over the tracked source, read as text:
//
//   1. No product code uses one of upstream CodeDen's identity values as a value (its npm
//      package, repository, home folder, projects folder, port, app id, link scheme, keychain
//      service, app name, or its command in text that says what to type), except the uses in
//      ALLOWED below, each with its reason.
//   2. Every place the fork redirected to its own channel (CALL_SITES below) still reads it.
//      The same list holds the defaults the fork sets differently (`harden-defaults.ts`).
//   3. README.md keeps the fork's wording: the credit to upstream on top, and below it no
//      mention of upstream's name outside README_ALLOWED (upstream edits its README often, so
//      this file conflicts on syncs: a conflict is resolved to the fork's wording, and upstream's
//      content changes are carried over by hand).
//
// Upstream's values are fixed text here and are never compared with this fork's own names, so
// the test reads the same in CodeHarden and in a fork configured with its own variables.
//
// This file is under scripts/harden/, which the sync workflow never lets an upstream merge
// change without a review.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** What ships or builds the product. Tests, docs and the fork's own scripts are not scanned. */
const IN_SCOPE = [
  /^(?:apps|packages)\/[^/]+\/src\//,
  /^(?:apps|packages)\/[^/]+\/scripts\//,
  /^(?:apps|packages)\/[^/]+\/[^/]+\.(?:ts|mts|mjs|js|json|html)$/,
  /^apps\/web\/public\/[^/]+\.webmanifest$/,
  /^apps\/cli\/docker\//,
  /^apps\/desktop\/build\/[^/]+\.plist$/,
  /^apps\/server\/templates\//,
  /^package\.json$/,
];
const OUT_OF_SCOPE = [
  /(?:^|\/)(?:test|e2e|__tests__)\//,
  /\.(?:test|spec)\.[a-z]+$/,
  /(?:^|\/)(?:vitest|playwright)\.config\.[a-z]+$/,
  /(?:^|\/)tsconfig[^/]*\.json$/,
  /\.(?:png|jpe?g|gif|ico|icns|svg|woff2?|wasm)$/,
];

function inScope(file) {
  return IN_SCOPE.some((p) => p.test(file)) && !OUT_OF_SCOPE.some((p) => p.test(file));
}

/**
 * Upstream's identity values, as they appear when code uses them as a value. `back` says what
 * came back, `use` what the fork reads instead: a constant of
 * `packages/contracts/src/harden-channel.ts`, or in a build script a field of
 * `readHardenChannel()` (`scripts/harden/channel-define.mjs`).
 */
const RULES = [
  {
    id: "npm-package",
    pattern:
      /npmjs\.org\/codeden\b|\/package\/codeden\b|\bnpm (?:i|install|view|exec|update)\b[^"'`\n]*\bcodeden\b|\bnpx (?:-y |--yes )?codeden\b|\bcodeden@(?!localhost\b)|node_modules["',\s/\\]+codeden\b/,
    back: "upstream's npm package `codeden` (a registry URL, an install or npx command, or its folder in node_modules)",
    use: "HARDEN_PACKAGE_NAME, HARDEN_INSTALL_COMMAND, HARDEN_NPX_COMMAND or HARDEN_PACKAGE_SEGMENTS",
  },
  {
    id: "repository",
    pattern: /leonvanzyl/i,
    back: "upstream's GitHub repository `leonvanzyl/codeden`",
    use: "HARDEN_REPOSITORY or a URL helper (hardenRepositoryUrl, hardenReleaseUrl, hardenLatestReleaseUrl, hardenChangelogUrl, hardenDocsUrl); in a build script `readHardenChannel().repository`",
  },
  {
    id: "home-folder",
    pattern: /(?<![\w-])\.codeden(?![\w-])/,
    back: "upstream's home folder name `.codeden`",
    use: "HARDEN_HOME_DIRNAME (HARDEN_HOME_DISPLAY in text shown to people)",
  },
  {
    id: "projects-folder",
    pattern: /codeden-projects/,
    back: "upstream's projects folder name `codeden-projects`",
    use: "HARDEN_PROJECTS_DIRNAME",
  },
  {
    id: "default-port",
    pattern: /(?<![\w.])4317(?![\w.])/,
    back: "upstream's default port 4317",
    use: "HARDEN_DEFAULT_PORT (the CLI's and the desktop app's `DEFAULT_PORT` read it)",
  },
  {
    id: "app-id",
    pattern: /dev\.codeden\b/,
    back: "upstream's app id `dev.codeden.app`",
    use: "HARDEN_APP_ID; in the packaging config `readHardenChannel().appId`",
  },
  {
    id: "link-scheme",
    pattern: /\bcodeden:\/\/|["'`]codeden:["'`]/,
    back: "upstream's link scheme `codeden://`",
    use: "HARDEN_DEEP_LINK_SCHEME (contracts' `DEEP_LINK_SCHEME` reads it)",
  },
  {
    id: "bare-name",
    pattern: /(["'`])codeden\1/,
    back: "the bare text `codeden` as a value (upstream's package name, command, link scheme and keychain service are all this word)",
    use: "HARDEN_PACKAGE_NAME, HARDEN_COMMAND, HARDEN_DEEP_LINK_SCHEME, HARDEN_KEYCHAIN_SERVICE or HARDEN_APP_SLUG, whichever this value is",
  },
  {
    // The command followed by a subcommand, an option or an argument: `codeden password`,
    // `codeden --port`, `codeden <dir>`. Not part of a longer name: `.codeden/`, `codeden/…`
    // branches, `@codeden/…` packages, `mcp__codeden__…`, `CODEDEN_…` variables, `codeden-…`.
    id: "command-in-text",
    pattern: /(?<![\w./@$-])codeden (?:--?[a-z]|[a-z<[])/,
    back: "upstream's command `codeden` in text that says what to type or names the program (`Run: codeden password`, `codeden --port`)",
    use: "HARDEN_COMMAND, put into the text in place of the word (HARDEN_PACKAGE_NAME where the text means the npm package); a line of the CLI's help goes inside `HELP = named(...)` in `apps/cli/src/args.ts`",
  },
  {
    id: "app-name",
    pattern:
      /(["'`])CodeDen\1|\bCodeDen[-_](?:Setup|\$\{)|\bCodeDen\.(?:app|exe|AppImage)\b|(?:productName|shortcutName|executableName|artifactName|applicationName|setName|setAppUserModelId|setTitle|\btitle)\b\W{0,6}CodeDen\b/,
    back: "upstream's product name `CodeDen` where it names the app (its name, a title, an installer or executable name)",
    use: "HARDEN_PRODUCT_NAME; in the packaging config `readHardenChannel().productName`",
  },
  {
    id: "sandbox-names",
    pattern:
      /\bcodeden-runner:|\blabel=codeden\.|(["'`])codeden\.(?:install|session|project|runner|version|build)\1|`codeden-\$\{/,
    back: "upstream's name for something in Docker: the sandbox image `codeden-runner:<version>`, a `codeden.*` label, or a container or volume named `codeden-<id>`",
    use: "HARDEN_APP_SLUG, through `imageName`, `LABEL` (`apps/server/src/execution/docker/args.ts`) and `containerNameFor` (`docker/backend.ts`)",
  },
];

const ANY = /^/;
const MOCK = /^apps\/web\/src\/lib\/api\/(?:mock\/|network-api\.ts$)/;
const WHY = {
  project:
    "the `.codeden/` folder inside a project's repository (its settings, vision, notes and automations): a file format shared with upstream, not this install's home",
  sender:
    "the sender id of messages the app itself sends (contracts' `MessageSender`), kept in transcripts",
  resolver: "the id of the app as the one who closed an inbox item (a contracts enum value)",
  mcp: "the `codeden` MCP server name agents see (their tools are `mcp__codeden__*`); renaming it would change every agent's tool names",
  mock: "sample data of the in-memory mock client (development only; builds always use the real server)",
  brand:
    "brand text the fork left as CodeDen: a label people read, not the app's identity on the machine",
  upstreamPack:
    "upstream's own manifest and publish step, kept as they are; the fork's release writes the name, links and README in a staging copy (`scripts/harden/npm-release.mjs`)",
  sandbox:
    "the package and command name inside the sandbox image (`codeden`, in `/opt/codeden`): nothing outside a container sees it, and the image is built on this machine from this build's own bundle, never fetched from npm under that name. What Docker itself is asked for by name (the image, labels, containers, volumes) is the fork's: rule `sandbox-names`",
  hello: "how the app introduces itself to an agent CLI or a web server (a client name)",
  commits: "the author name of checkpoint commits and of git inside the sandbox image",
  runnerLabel:
    "the prefix of the runner's own log and error lines: the process and its link, which the sandbox image starts as `codeden runner-link` (see `sandbox`). A label in a log, not a command a person is told to type",
};

/**
 * The uses of upstream's values that stay: `[files, text, reason]`. An entry exempts only the
 * text its pattern matches, in the files it names; anything else on the same line or in the
 * same file is still checked. Add an entry only with a reason a reviewer can judge ("the test
 * failed" is not one). An entry that no longer matches anything fails the test.
 *
 * `files` is one path, a pattern, or a list of them. A list is for a line upstream moves to
 * another file: the entry names the old and the new path, so it holds before and after that
 * sync merges (one match in any of them makes it used), and goes back to the one path once
 * the sync is in.
 */
// biome-ignore format: one entry per line, read as a table
const ALLOWED = [
  // --- the upstream home's name, kept on purpose
  ["packages/contracts/src/harden-channel.ts", /UPSTREAM_HOME_DIRNAME = "\.codeden"/, "the upstream home's name, kept to tell people about the old home (`hardenHomeNotice`); nothing is read from or written to it"],
  // --- `.codeden/` inside a repository
  [ANY, /(?<![~\w]\/)\.codeden\/(?:project\.json|VISION\.md|notes\.md)/, WHY.project],
  [/^apps\/(?:server\/src\/services\/factory\/prompts\.ts|web\/src\/lib\/api\/mock\/)/, /(?<![~\w]\/)\.codeden\/(?:automations\/|`)/, WHY.project],
  ["apps/server/src/services/automations/sources.ts", /join\("\.codeden", "automations"\)/, WHY.project],
  ["apps/server/src/services/projects/project-config.ts", /join\(projectPath, "\.codeden", "project\.json"\)/, WHY.project],
  ["apps/server/src/services/factory/policy.ts", /"\*\*\/\.codeden\/\*\*"|\(\?:\.\*\\\/\)\?\\\.codeden\\\//, WHY.project],
  ["packages/providers/src/policy/project-config.ts", /base === "\.codeden"|lastIndexOf\("\.codeden"\)|\/\\\.codeden\[\\\\\/\]\+/, WHY.project],
  ["apps/web/src/lib/api/mock/fixtures/workbench.ts", /d\("\.codeden",/, WHY.project],
  // --- ids in the protocol and in stored data
  [/^apps\/server\/src\/services\//, /\bfrom(?::| ===| !==) "codeden"/, WHY.sender],
  ["apps/server/src/services/container.ts", /whenBusy: "queue" \}, "codeden"\)/, WHY.sender],
  ["apps/server/src/services/sessions/session-service.ts", /\}, "codeden"\);/, WHY.sender],
  ["apps/server/src/services/orchestration/orchestration-service.ts", /^\s*"codeden",$/, WHY.sender],
  ["packages/contracts/src/input.ts", /^\s*"codeden",$/, WHY.sender],
  ["apps/server/src/events/reducer/signin.ts", /by: "codeden"/, WHY.resolver],
  ["apps/server/src/services/inbox-settle.ts", /const by = "codeden" as const/, WHY.resolver],
  ["packages/contracts/src/entities/inbox.ts", /z\.enum\(\["codeden", "factory"\]\)/, WHY.resolver],
  [/^(?:apps\/server\/src\/routes\/api\.ts|packages\/contracts\/src\/ws\.ts)$/, /name: (?:"codeden"|z\.literal\("codeden"\)),/, "the protocol name in the health answer; a running server is found through its own home's lock file, so this name doesn't tell installs apart"],
  // --- the MCP server name
  ["apps/server/src/mcp/prompt.ts", /MCP_SERVER_NAME = "codeden"/, WHY.mcp],
  ["apps/server/src/mcp/endpoint.ts", /realm="codeden"|\{ name: "codeden", version: CODEDEN_VERSION \}/, WHY.mcp],
  ["apps/server/src/services/agent-config/agent-config-service.ts", /(?:provider|name): "codeden"/, WHY.mcp],
  ["packages/contracts/src/agent-config.ts", /z\.enum\(\["claude", "codex", "codeden"\]\)/, WHY.mcp],
  ["packages/providers/src/fake/session.ts", /server: "codeden"/, WHY.mcp],
  ["apps/web/src/lib/mcp-status.ts", /CODEDEN_MCP_SERVER = "codeden"|provider === "codeden"/, WHY.mcp],
  [/^apps\/web\/src\/components\/agents\/mcp-server(?:s|-dialog)\.tsx$/, /provider [!=]== "codeden"/, WHY.mcp],
  [/^apps\/web\/src\/lib\/api\/mock\/fixtures\/(?:config|sessions|transcripts-[ab])\.ts$/, /(?:provider|name): "codeden"|^\s*"codeden",$|mcp\("[\w-]+", "codeden",/, WHY.mcp],
  // --- the mock client's sample data
  ["apps/web/src/lib/api/mock/index.ts", /runTurn\(id, brief, "codeden"\)/, WHY.mock],
  [MOCK, /~\/\.codeden\/(?:wt|backups|orchestrator|models|deps)\b/, WHY.mock],
  [MOCK, /\\\\\.codeden\\\\wt\\\\/, WHY.mock],
  ["apps/web/src/lib/api/network-api.ts", /(?:url: "http:\/\/[\w.]+:|^\s*port: )4317\b/, WHY.mock],
  ["packages/contracts/src/dev-preview.ts", /DEV_PREVIEW_RESERVED_PORTS: readonly number\[\] = \[4317, 4417, 4318, 4319, 5173, 5174\];/, "upstream's default port in the list of ports a dev preview is never given: a port to keep away from, so that a preview can't take the port of an upstream install on the same machine. This install's own port is added to the list from HARDEN_DEFAULT_PORT (`dev-preview-service.ts`)"],
  // --- client names and commit authors
  [/^packages\/providers\/src\/(?:acp|codex)\/process\.ts$/, /clientInfo: \{ name: "codeden", title: "CodeDen",/, WHY.hello],
  ["apps/server/src/services/automations/import-link.ts", /"user-agent": "codeden"/, WHY.hello],
  ["apps/server/src/services/remote-image.ts", /"user-agent": "CodeDen"/, WHY.hello],
  ["packages/providers/src/opencode/session-open.ts", /INSTRUCTIONS_KEY = "codeden"/, "the key of the app's entry in an OpenCode session's instructions"],
  ["apps/runner/src/git/checkpoints.ts", /GIT_(?:AUTHOR|COMMITTER)_NAME: "CodeDen"/, WHY.commits],
  ["apps/cli/docker/Dockerfile", /user\.name "CodeDen"/, WHY.commits],
  ["apps/runner/src/git/checkpoints.ts", /"-m", "codeden checkpoint"/, "the reflog message of a checkpoint ref, written into repositories' git data: a stored label shared with upstream, not a command"],
  // --- the command name where it is not something a person is told to type
  ["apps/cli/src/args.ts", /^ {2}codeden (?=[a-z[])/, "a line of the CLI's help, inside `HELP = named(...)`: `named()` rewrites every such line to the channel's command before it is shown (the file's CALL_SITES entry checks that the help is still wrapped and that no such line stands outside it)"],
  ["apps/runner/src/main.ts", /(?<=["`])codeden runner: /, WHY.runnerLabel],
  ["apps/runner/src/link/runner-link.ts", /(?<=`)codeden runner-link: /, WHY.runnerLabel],
  ["packages/contracts/src/network.ts", /^\s*"codeden",$/, "an entry in the list of passwords too easy to guess"],
  // --- the sandbox image
  ["apps/server/src/execution/docker/args.ts", /^\s*"codeden",$/, WHY.sandbox],
  ["apps/server/src/execution/docker/image.ts", /\{ name: "codeden", version, private: true,/, WHY.sandbox],
  // --- upstream's manifest and publish step
  ["apps/cli/package.json", /"name": "codeden"|"codeden": "\.\/dist\/cli\.js"|github\.com\/leonvanzyl\/codeden(?:\.git|\/issues)"/, WHY.upstreamPack],
  ["apps/cli/scripts/copy-readme.mjs", /(?:REPO|RAW) = "https:\/\/(?:github\.com|raw\.githubusercontent\.com)\/leonvanzyl\/codeden(?:\/main)?"/, WHY.upstreamPack],
  // --- brand text
  ["apps/web/src/components/shell/live-effects.tsx", /\?\? "CodeDen",/, WHY.brand],
  ["apps/web/src/components/thread/sender-message.tsx", /codeden: (?:\{ label: )?"CodeDen"/, WHY.brand],
  ["apps/web/src/components/agents/mcp-servers.tsx", /codeden: "CodeDen"/, WHY.brand],
  ["apps/web/src/components/automations/meta.ts", /database: "CodeDen"/, WHY.brand],
  [/^apps\/server\/src\/services\/sessions\/(?:handoff-brief|transcript-items)\.ts$/, /codeden: "CodeDen"/, WHY.brand],
  ["apps/server/src/services/agent-config/agent-config-service.ts", /file: "CodeDen"/, WHY.brand],
].map(allowedEntry);

/** An ALLOWED row as the scanner uses it; its pattern is applied to every match on a line. */
function allowedEntry([file, pattern, reason]) {
  return { file, pattern: new RegExp(pattern.source, `${pattern.flags}g`), reason };
}

/**
 * A script's text without its comments (line breaks kept). Strings and template strings are
 * followed, so a comment opener inside one never hides the code after it, and a comment must
 * start a line or follow a space, so a glob ending in slash-star is not one. When in doubt the
 * text is kept: a comment read as code can only cause a failure, never hide a value.
 */
function withoutComments(text) {
  let out = "";
  let state = "code";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === "line" || state === "block") {
      if (ch === "\n") out += ch;
      if (state === "line" ? ch === "\n" : ch === "*" && next === "/") {
        if (state === "block") i++;
        state = "code";
      }
    } else if (state !== "code") {
      out += ch;
      if (ch === "\\" && next !== undefined) out += text[++i];
      else if (ch === state || (ch === "\n" && state !== "`")) state = "code";
    } else if (
      ch === "/" &&
      (next === "/" || next === "*") &&
      (i === 0 || /\s/.test(text[i - 1]))
    ) {
      state = next === "/" ? "line" : "block";
      i++;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") state = ch;
      out += ch;
    }
  }
  return out;
}

/** Lines of `text` with comments blanked, so prose about upstream is never a hit. */
function codeLines(file, text) {
  if (/\.[cm]?[jt]sx?$/.test(file)) return withoutComments(text).split("\n");
  const hash = /\.(?:sh|ya?ml)$|Dockerfile$/.test(file);
  return text.split("\n").map((line) => (hash && /^\s*#/.test(line) ? "" : line));
}

/** True when `where` (a path, a pattern, or a list of them) names `file`. */
const names = (where, file) =>
  Array.isArray(where)
    ? where.some((one) => names(one, file))
    : typeof where === "string"
      ? where === file
      : where.test(file);
const appliesTo = (entry, file) => names(entry.file, file);

/**
 * Upstream identity values used in `text`, after the allowed uses are taken out. Every entry
 * of `allowed` that took something out is added to `used`.
 */
function scan(file, text, used = new Set(), allowed = ALLOWED) {
  const entries = allowed.filter((entry) => appliesTo(entry, file));
  const hits = [];
  codeLines(file, text).forEach((code, index) => {
    if (!/codeden|leonvanzyl|4317/i.test(code)) return;
    let rest = code;
    for (const entry of entries) {
      rest = rest.replace(entry.pattern, (match) => {
        used.add(entry);
        return "\u0000".repeat(match.length);
      });
    }
    for (const rule of RULES) {
      if (rule.pattern.test(rest)) hits.push({ file, line: index + 1, rule, text: code.trim() });
    }
  });
  return hits;
}

/** The entries of `allowed` that took nothing out of any scanned file, as the report lists them. */
function staleEntries(allowed, used) {
  const where = (file) => (Array.isArray(file) ? file.map(String).join(" | ") : String(file));
  return allowed
    .filter((entry) => !used.has(entry))
    .map((entry) => `${where(entry.file)}: ${entry.pattern.source}\n    (${entry.reason})`);
}

function hitReport(hits) {
  const list = hits.map(
    (hit) =>
      `${hit.file}:${hit.line}\n    ${hit.text.slice(0, 160)}\n    Came back: ${hit.rule.back}.\n    Use instead: ${hit.rule.use}.`,
  );
  return `\n\nUpstream's identity is used in product code (${hits.length}). With these, part of this product behaves like upstream CodeDen again. Change each to the fork's value; add it to ALLOWED in scripts/harden/upstream-drift.test.mjs only if it is not the install's identity, with the reason.\n\n${list.join("\n\n")}\n`;
}

/**
 * Where the fork redirected upstream's code to its own channel, derived from the fork's diff
 * against upstream: `[file, what the fork changed there, ...what the file must still contain]`.
 * A name is looked for as a word in the file's code (comments don't count), a pattern as
 * written, and a function is asked.
 */
// biome-ignore format: one entry per line, read as a table
const CALL_SITES = [
  // --- the channel itself
  ["packages/contracts/src/harden-channel.ts", "the one module that names the package, repository and identity", "HARDEN_PACKAGE_NAME", "HARDEN_REPOSITORY", "HARDEN_PRODUCT_NAME", "HARDEN_APP_ID", "HARDEN_HOME_DIRNAME", "HARDEN_PROJECTS_DIRNAME", "HARDEN_KEYCHAIN_SERVICE", "HARDEN_DEEP_LINK_SCHEME", "HARDEN_DEFAULT_PORT", "__CODEHARDEN_PACKAGE__", "__CODEHARDEN_SLUG__", "__CODEHARDEN_PORT__"],
  ["packages/contracts/src/harden-version.ts", "the version line every display uses", "formatHardenVersion", "HARDEN_VERSION", "UPSTREAM_VERSION", "__CODEHARDEN_VERSION__"],
  ["packages/contracts/src/index.ts", "exports the channel, the defaults, the version and the brand modules", /export \* from "\.\/harden-channel"/, /export \* from "\.\/harden-defaults"/, /export \* from "\.\/harden-version"/, /export \* from "\.\/harden-brand"/, /export \* from "\.\/harden-mark"/],
  ["packages/contracts/src/harden-brand.ts", "the wordmark's two parts and the paths of the product's own web icons", "hardenWordmark", "hardenWordmarkHtml", "HARDEN_WEB_ICONS", "HARDEN_PUBLIC_ICON_PATHS", "HARDEN_FAVICON_PATH"],
  ["packages/contracts/src/harden-mark.ts", "the mark's shapes and the brand's colours, written by scripts/harden/brand/make.mjs", "HARDEN_MARK", "HARDEN_BRAND_RED", "HARDEN_BRAND_RED_ON_DARK", "HARDEN_BRAND_WHITE"],
  ["packages/contracts/package.json", "lets the CLI launcher load the channel alone", /"\.\/harden-channel": "\.\/src\/harden-channel\.ts"/],
  ["packages/contracts/src/desktop.ts", "the link scheme the desktop app registers", /DEEP_LINK_SCHEME = HARDEN_DEEP_LINK_SCHEME/],
  ["packages/contracts/src/ws.ts", "the two versions in the health answer and the snapshot", "hardenVersion", "upstreamVersion"],
  // --- every bundle gets both build-time defines
  ["apps/cli/tsdown.config.ts", "injects the version and the channel into the CLI bundle", bothDefinesInEveryBundle],
  ["apps/desktop/tsdown.config.ts", "injects the version and the channel into the desktop bundles", bothDefinesInEveryBundle],
  ["apps/web/vite.config.ts", "injects the version and the channel into the web app", bothDefinesInEveryBundle, /hardenWebIdentity\(\)/],
  // --- home, port, projects folder, keychain
  ["apps/server/src/paths.ts", "the default home folder", /join\(homedir\(\), HARDEN_HOME_DIRNAME\)/],
  ["apps/server/src/services/container.ts", "the default folder for clones", /join\(userHome, HARDEN_PROJECTS_DIRNAME\)/],
  ["apps/server/src/services/secrets.ts", "the keychain service secrets are kept under", /service = HARDEN_KEYCHAIN_SERVICE/],
  ["apps/server/src/security.ts", "the command the locked page tells people to run, that page's title and wordmark, and the product's icons a browser may fetch without a cookie", "HARDEN_NPX_COMMAND", /<title>\$\{HARDEN_PRODUCT_NAME\}<\/title>/, /<h1>\$\{hardenWordmarkHtml\("dark"\)\} is locked<\/h1>/, /\.\.\.HARDEN_PUBLIC_ICON_PATHS,/],
  ["apps/server/src/routes/api.ts", "the versions the server reports", "HARDEN_VERSION", "UPSTREAM_VERSION"],
  ["apps/cli/src/args.ts", "the CLI's default port, home and command in the help (every help line is renamed by `named()`)", /DEFAULT_PORT = HARDEN_DEFAULT_PORT/, "HARDEN_HOME_DISPLAY", "HARDEN_COMMAND", "formatHardenVersion", /export const HELP = named\(`/, helpLinesOnlyInHelp],
  ["apps/cli/src/network-command.ts", "the network command's port comes from the CLI's default, and its usage and hints name the channel's command", /import \{ DEFAULT_PORT \} from "\.\/args"/, /`Usage: \$\{HARDEN_COMMAND\} network /, /`Run: \$\{HARDEN_COMMAND\} password`/],
  ["apps/cli/src/launcher.ts", "the launcher's home, the installed package it may start and the commands it prints", /join\(homedir\(\), HARDEN_HOME_DIRNAME\)/, /pkg\.name !== HARDEN_PACKAGE_NAME/, "HARDEN_PACKAGE_SEGMENTS", "HARDEN_NPX_COMMAND", "HARDEN_UPDATE_COMMAND", "HARDEN_COMMAND", /export \{ HARDEN_PRODUCT_NAME \};/, /`\$\{HARDEN_PRODUCT_NAME\} \$\{pinned\} in /],
  ["apps/cli/src/harden-home.ts", "the notice about the old home", "HARDEN_HOME_DIRNAME", "UPSTREAM_HOME_DIRNAME", "hardenHomeNotice"],
  ["apps/cli/src/cli.ts", "the bare package version is printed for the updater's probe only, and the warning about an installed version that didn't load names the product", /CODEDEN_NO_SWITCH === "1"/, /`\$\{HARDEN_PRODUCT_NAME\} \$\{decision\.version\} failed to load/],
  ["apps/cli/src/main.ts", "the version line of `--version`, and the command in the usage of `runner-link`", "formatHardenVersion", "HARDEN_COMMAND"],
  ["apps/cli/src/commands.ts", "the version line and command name in CLI output", "formatHardenVersion", "HARDEN_COMMAND", /Try: \$\{HARDEN_COMMAND\} --port /],
  ["apps/cli/src/doctor.ts", "the version line, the update command and the install hint in `doctor`", "formatHardenVersion", "HARDEN_UPDATE_COMMAND", /\$\{HARDEN_COMMAND\} doctor --install/],
  ["packages/providers/src/claude/sdk/load.ts", "the command in the hint shown when Claude Code support can't be installed", /\$\{HARDEN_COMMAND\} doctor --install/],
  ["apps/web/src/components/settings/sections-network.tsx", "the command in the Trusted origins hint of Settings › Network access", /\{HARDEN_COMMAND\} network origin add /],
  ["apps/server/src/execution/docker/backend.ts", "the npm package named when the sandbox image can't be built", /from the \$\{HARDEN_PACKAGE_NAME\} package/],
  ["apps/cli/scripts/third-party-notices.mjs", "the package named at the top of the bundled licence notices", /readHardenChannel\(process\.env, \{ quiet: true \}\)\.packageName/],
  // --- defaults the fork sets differently from upstream
  ["packages/contracts/src/harden-defaults.ts", "the provider switch at a usage limit ships off (a person turns it on in Settings › Providers)", /HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT = false;/],
  ["packages/contracts/src/settings.ts", "the default of `providers.autoSwitchOnLimit` is the fork's, not upstream's `true`", /autoSwitchOnLimit: z\.boolean\(\)\.default\(HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT\),/],
  ["apps/cli/src/update-command.ts", "the update command it prints, and the product's name in every message of the update command", "HARDEN_UPDATE_COMMAND", productNameOnlyByConstant],
  ["apps/cli/src/restart.ts", "the product's name in the messages of the restart into an updated version", productNameOnlyByConstant],
  // --- the sandbox in Docker: one Docker is shared by every product on the machine
  ["apps/server/src/execution/docker/args.ts", "the sandbox image's name and the labels on images, containers and volumes", /`\$\{HARDEN_APP_SLUG\}-runner:\$\{version\}`/, /install: `\$\{HARDEN_APP_SLUG\}\.install`/, /build: `\$\{HARDEN_APP_SLUG\}\.build`/],
  ["apps/server/src/execution/docker/backend.ts", "the names of sandbox containers (and through them their volumes)", /`\$\{HARDEN_APP_SLUG\}-\$\{recordId\}`/],
  // --- self-update: only the channel's package, only the fork's releases
  ["apps/server/src/services/updates/app-dir.ts", "the package self-update installs and may run", /PACKAGE_NAME = HARDEN_PACKAGE_NAME/, /pkg\.name !== PACKAGE_NAME/],
  ["apps/server/src/services/updates/registry.ts", "the registry lookup and the release notes links", /registryPackagePath\(PACKAGE_NAME\)/, "hardenReleaseUrl", "hardenReleaseApiUrl", "hardenChangelogUrl", "hardenVersionOf"],
  ["apps/server/src/services/updates/installer.ts", "what npm is asked to install", /`\$\{PACKAGE_NAME\}@\$\{version\}`/],
  ["apps/server/src/services/updates/desktop.ts", "where desktop installers are downloaded from, and the product's name in the restart hint", /DESKTOP_RELEASES_URL = hardenLatestReleaseUrl\(\)/, productNameOnlyByConstant],
  ["apps/server/src/services/updates/service.ts", "the manual install command, the product's name in the update messages, and what a source build compares the registry's version with", "HARDEN_INSTALL_COMMAND", productNameOnlyByConstant, /isNewerVersion\(this\.latest, hardenUpdateBaseline\(this\.host\.source, current, this\.latest\)\)/],
  ["apps/server/src/services/updates/harden-baseline.ts", "a source build compares the registry's version with the CodeHarden version it was made from, not with upstream's package version", "hardenUpdateBaseline", "HARDEN_VERSION", "hardenNpmVersion", /source !== "source"/],
  // --- desktop app and its packaging
  ["apps/desktop/electron-builder.config.mjs", "the installer's app id, names, link scheme, update feed and app icon (the product's own, not upstream's build/icon.png); the channel is read without options, so HARDEN_RELEASE_PACK alone decides whether it is strict", /^const channel = readHardenChannel\(\);$/m, /^ {2}appId,$/m, /^ {2}productName,$/m, /schemes: \[slug\]/, /owner: channel\.owner, repo: channel\.repo/, /executableName: productName/, /executableName: slug/, /shortcutName: productName/, /icon: "build\/harden\/icon\.icns"/, /icon: "build\/harden\/icon\.ico"/, /icon: "build\/harden\/icons"/],
  ["apps/desktop/scripts/package.mjs", "the staged app's name and version, and installers packed as a release: the signal is set before the channel is read and before the builder configuration (which reads it too) is loaded", /if \(!values\.dir\) process\.env\[RELEASE_PACK_VARIABLE\] = "1";\nconst channel = readHardenChannel\(\);\s*const \{ default: config, keyringBinary \} = await import\("\.\.\/electron-builder\.config\.mjs"\);/, /name: channel\.slug/, /productName: channel\.productName/, /npmVersion\(readHardenVersion\(\)\)/],
  ["apps/desktop/scripts/check-mac-signature.sh", "finds the app by its own name", "app_in", "CFBundleExecutable"],
  ["apps/desktop/src/main/args.ts", "the desktop app's default port and home", /DEFAULT_PORT = HARDEN_DEFAULT_PORT/, /join\(home, HARDEN_HOME_DIRNAME\)/],
  ["apps/desktop/src/main/main.ts", "the app's name, About panel and Windows app id", /app\.setName\(HARDEN_PRODUCT_NAME\)/, /setAppUserModelId\(HARDEN_APP_ID\)/, "hardenAboutPanel"],
  ["apps/desktop/src/main/harden-display.ts", "the window title (the page name it replaces is the product name) and About panel", "hardenWindowTitle", "hardenAboutPanel", /PAGE_NAME = HARDEN_PRODUCT_NAME/],
  ["apps/desktop/src/main/window.ts", "the window title", "hardenWindowTitle"],
  ["apps/desktop/src/main/desktop-app.ts", "the app's name, version line and docs links, and its own tray, menu-bar and window icons", "HARDEN_PRODUCT_NAME", "formatHardenVersion", "hardenDocsUrl", "hardenVersionOf", /"harden\/trayTemplate\.png" : "harden\/tray\.png"/, bothWindowIconsAreTheForks],
  ["apps/desktop/src/main/menu.ts", "the app's name in the menu", "HARDEN_PRODUCT_NAME"],
  ["apps/desktop/src/main/tray.ts", "the app's name in the tray", "HARDEN_PRODUCT_NAME"],
  ["apps/desktop/src/main/tray-view.ts", "the app's name and version in the tray menu", "HARDEN_PRODUCT_NAME", "hardenVersionOf"],
  ["apps/desktop/src/server/serve.ts", "the name and version line of the server the app hosts", "HARDEN_PRODUCT_NAME", "formatHardenVersion"],
  // --- web UI
  ["scripts/harden/web-identity.mjs", "the build step that names the page and the web manifest after the product and points them at its icons", /readHardenChannel\(env, options\)/, "productName", "titledHtml", "namedManifest", "brandedHtml", "brandedManifest", "HARDEN_ICONS"],
  ["apps/web/index.html", "the places the build puts the product name in (the page title, the home-screen title) and the icon links it points at the product's icons", /<title>[^<]+<\/title>/, /name="apple-mobile-web-app-title" content="/, /rel="manifest" href="\/manifest\.webmanifest"/, /<link rel="icon"[^>]* href="/, /<link rel="apple-touch-icon" href="/],
  ["apps/web/public/manifest.webmanifest", "the installed web app's name and icons, which the build replaces with the product's; a build does not fail when this file is gone", /"name": "/, /"short_name": "/, /"icons": \[/],
  ["apps/web/src/lib/attention/title.ts", "the tab title, bare, counted and waiting", /APP_TITLE = HARDEN_PRODUCT_NAME/, /Waiting on you · \$\{APP_TITLE\}/],
  ["apps/web/src/lib/platform.ts", "the tab title the badge falls back to, and the icon of browser notifications", /document\.title : HARDEN_PRODUCT_NAME/, /icon: HARDEN_FAVICON_PATH/],
  ["apps/server/src/routes/static.ts", "the title of the page served when the web UI is not built", /<title>\$\{HARDEN_PRODUCT_NAME\}<\/title>/, /hardenWordmarkHtml\("light"\)/],
  ["apps/web/src/components/shell/unauthorized.tsx", "the command the locked page tells people to run, and the wordmark in its heading", "HARDEN_NPX_COMMAND", /<Wordmark \/>/],
  // --- the logo and the wordmark
  ["apps/web/src/components/shell/logo.tsx", "the logo: the product's mark (a shield), not upstream's", "HARDEN_MARK", "HARDEN_BRAND_RED", "HARDEN_BRAND_WHITE"],
  ["apps/web/src/components/shell/wordmark.tsx", "the product name as the brand, in two colours", "hardenWordmark", /text-brand-text/],
  ["apps/web/src/index.css", "the brand's colour tokens (written by scripts/harden/brand/make.mjs)", /@import "\.\/harden-brand\.css";/],
  ["apps/web/src/harden-brand.css", "the brand's colour tokens for both themes", /--color-brand-text: var\(--brand-text\)/, /--brand: #[0-9a-f]{6};/, /\.dark \{\n {2}--brand-text: #[0-9a-f]{6};/],
  ["apps/web/src/components/shell/sidebar/sidebar.tsx", "the wordmark beside the logo in the sidebar", /<Wordmark className=/],
  ["apps/web/src/components/shell/sign-in.tsx", "the wordmark in the sign-in heading", /Sign in to <Wordmark \/>/],
  ["apps/web/src/routes/setup.tsx", "the wordmark in the first-run heading", /Welcome to <Wordmark \/>/],
  ["apps/web/src/lib/api/updates-api.ts", "release links, and the product's name in the mock client's update message", "hardenReleaseUrl", productNameOnlyByConstant],
  ["apps/web/src/components/shell/update-banner.tsx", "the product's name in the update banner, in each of its states", productNameOnlyByConstant, /\{HARDEN_PRODUCT_NAME\} \{view\.version\} is available\./, /\{HARDEN_PRODUCT_NAME\} updated to \{view\.version\}\./],
  ["apps/web/src/components/shell/whats-new-dialog.tsx", "the product's name in the title of \"What's new\"", productNameOnlyByConstant, /What's new in \{HARDEN_PRODUCT_NAME\} \{version\}/],
  ["apps/web/src/components/settings/update-mode.tsx", "the product's name in the help of the Updates setting", productNameOnlyByConstant],
  ["apps/web/src/lib/factory-guide.ts", "docs links", "hardenDocsUrl"],
  ["apps/web/src/routes/settings.tsx", "the version line in Settings, its name as the wordmark", "formatHardenVersion", /<WordmarkLine text=\{versionLine\} \/>/],
  // --- Secure Foundation: the add-project option, slotted into upstream's files
  ["apps/web/src/components/setup/add-project-dialog.tsx", "the Secure Foundation option in the add-project dialog", /<SecureFoundationSlot \/>/],
  ["apps/web/src/routes/project.tsx", "the Secure Foundation setup status on the project page", /<SecureFoundationStatus projectId=\{projectId\} \/>/],
  ["apps/web/src/lib/api/http-client.ts", "the web client's Secure Foundation calls", /secureFoundation: httpSecureFoundationApi\(http\)/],
  ["apps/server/src/routes/api.ts", "the Secure Foundation routes", /\.route\("\/secure-foundation", secureFoundationRoutes\(s\)\)/],
  ["apps/server/src/services/container.ts", "the Secure Foundation service", /secureFoundation: createSecureFoundation\(/],
  ["apps/server/src/services/container.ts", "where Secure Foundation keeps the answers a dev preview depends on: the app's home", /secureFoundation: createSecureFoundation\(\{\n\s+exec,\n\s+home: opts\.paths\.home,/],
  ["packages/contracts/src/index.ts", "exports the contract of a Secure Foundation project's dev preview", /export \* from "\.\/secure-foundation-dev-preview"/],
  ["packages/contracts/src/index.ts", "exports the contract of the repository secrets a Secure Foundation project's workflows need", /export \* from "\.\/secure-foundation-repo-secrets"/],
  ["apps/server/src/services/orchestration/orchestration-service.ts", "a quiet Secure Foundation project's manager is not woken", /if \(holdsPmWakes\(this\.deps, projectId\)\) return "empty";/],
  ["apps/server/src/services/secure-foundation/index.ts", "the template comes from the fork's configuration, never from a request", "HARDEN_TEMPLATE_REPOSITORY", "HARDEN_TEMPLATE_BRANCH", "hardenTemplateUrl"],
  ["packages/contracts/src/harden-channel.ts", "the Secure Foundation template in the fork's configuration", "HARDEN_TEMPLATE_REPOSITORY", "HARDEN_TEMPLATE_BRANCH", "__CODEHARDEN_TEMPLATE_REPOSITORY__", "__CODEHARDEN_TEMPLATE_BRANCH__"],
  ["packages/contracts/src/provider.ts", "the capability the setup brief reads instead of a provider id", "projectCommands"],
  ["packages/providers/src/claude/adapter.ts", "the provider that runs project command files says so", /projectCommands: true/],
  // --- Dev preview: a fork-only feature, slotted into upstream's files one line at a time
  ["packages/contracts/src/index.ts", "exports the dev preview's contracts", /export \* from "\.\/dev-preview"/],
  ["apps/server/src/routes/api.ts", "the dev preview routes", /\.route\("\/dev-preview", devPreviewRoutes\(s\)\)/],
  ["apps/server/src/services/container.ts", "the dev preview service", /devPreview: createDevPreview\(/],
  ["apps/server/src/server.ts", "the dev preview starts with the server (ending what a crash left) and stops every preview when the server closes", /services\.devPreview\.start\(\{ port \}\)/, /await services\.devPreview\.stop\(\)/],
  ["apps/server/src/routes/dev-preview.ts", "setting commands and starting previews are refused to other devices", "requireLocal", "isRemoteRequest", "SetDevPreviewRequest"],
  ["apps/server/src/services/dev-preview/process.ts", "a preview's processes get a terminal's environment, without the app's own variables", "agentEnv", "defaultShell"],
  ["apps/web/src/components/thread/thread-view.tsx", "the dev preview bar under a thread's header", /<DevPreviewBar session=\{session\} \/>/],
  ["apps/web/src/components/orchestration/role-chat.tsx", "the dev preview bar on a PM thread that hasn't started", /<DevPreviewPmBar projectId=\{role === "pm" \? projectId : null\} \/>/],
  ["apps/web/src/routes/project.tsx", "the dev preview section of a project's settings", /<DevPreviewProjectSettings project=\{project\} \/>/],
  ["apps/web/src/routes/settings.tsx", "the dev preview limits in the app's settings", /render: \(\) => <DevPreviewLimitsSettings \/>/],
  ["apps/web/src/lib/api/http-client.ts", "the web client's dev preview calls", /devPreview: httpDevPreviewApi\(http\)/],
  // --- A new project's scheduled starter automations: staggered start times, set where upstream creates the starter set
  ["apps/server/src/services/automations/definitions.ts", "a new starter automation is created with the next free start time among the active projects' copies (as part of its creation, not as an edit)", /const trigger = staggeredStarterTrigger\(template, project, this\.deps\.projects\.list\(\), /, /this\.create\(\{ templateId: template\.id, projectId, enabled: enable, trigger \}, \{ id \}\)/],
  ["apps/server/src/services/harden/starter-stagger.ts", "the rule itself: 10-minute steps, only plain minute and hour fields, never past midnight, archived projects and the project itself take no slot", "staggeredCron", "STAGGER_STEP_MINUTES = 10", "MINUTES_PER_DAY", /other\.id === project\.id \|\| other\.archivedAt !== null/],
  // --- OpenCode sessions: slash commands are plain prompts in this fork for now
  ["packages/providers/src/opencode/commands.ts", "the commands OpenCode lists pass the fork's switch before they are reported or routed", /commands = hardenListedCommands\(/],
  ["packages/providers/src/opencode/harden-commands.ts", "the switch itself, off in the product", "hardenListedCommands", /^let run = false;$/m],
  // --- fixes the fork carries in upstream's files until upstream has its own. Each has tests of its own (packages/providers/test/harden-risk-stricter.test.ts, harden-scan.test.ts; apps/server/test/harden-factory-hold.test.ts, harden-update-install-env.test.ts): when upstream's fix replaces one in a sync and those tests still pass, take upstream's form and remove the entry.
  ["packages/providers/src/policy/harden-scan.ts", "the fork's reading of quoted strings and two-part patterns in one pass, the longest command the classifier reads and the work limit", "quotedSpans", "followedBy", "MAX_COMMAND_CHARS", "TOO_LONG", "MAX_WORK_CHARS", "TOO_INVOLVED", "bounded", "spend", holds("if (error instanceof WorkLimit || error instanceof RangeError) return otherwise;")],
  ["packages/providers/src/policy/risk.ts", "a command longer than the limit, or too involved to read, asks instead of being read or failing; the download check reads its two parts in one pass", holds("if (command.length > MAX_COMMAND_CHARS) return TOO_LONG;"), holds("return bounded(() => classifyWithin(command, given), TOO_INVOLVED);"), holds("followedBy("), lacks("[^|]*\\b(irm|iwr")],
  ["packages/providers/src/policy/read-only.ts", "a command longer than the limit is refused in a read-only session", holds("if (command.length > MAX_COMMAND_CHARS) {")],
  ["packages/providers/src/policy/workdir.ts", "a line too long or too involved to read is not known to only read", holds("(line) => line.length <= MAX_COMMAND_CHARS && readsOnly("), holds("return bounded(")],
  ["packages/providers/src/policy/paths.ts", "a brace expansion in a cd is found without reading on to a far closing brace", holds("\\{[^{}]*\\}/.test(raw)")],
  ["packages/providers/src/policy/inline-code.ts", "string literals, backtick commands and the two `open` checks are read in one pass (not by a pattern that starts over from every quote or every `open`)", holds("quotedSpans(read, QUOTES)"), holds("quotedSpans(code, QUOTES)"), holds('quotedSpans(code, "`", false)'), lacks("matchAll(LITERAL)"), holds("if (!WRITES.test(code) && !opensToWrite(code)) return [];"), lacks("open\\s*\\([^)]*,")],
  ["packages/providers/src/policy/variables.ts", "a command line that sets a variable the path rules know, or repeats a command for several values, is also read with the other possibilities; a mktemp template, a braced variable and a temp default are matched in one pass", "variableReadings", holds("if (seen.ambient) readings.push(read({ keepAmbient: true }));"), holds("if (seen.ambient || seen.spread) readings.push(read({ every: true }));"), holds("if (how.keepAmbient) return;"), holds("for (const copy of how.every && copies.length > 1 ? copies : [copies[0] ?? cmd]) {"), holds("if (how.every) table.set(name, null);"), holds("if (moves) return EITHER;"), holds("for (const word of (cmd as Marked).unsure ?? []) {"), ambientNames, holds("/X{3}/i.test(template)"), lacks("X{3,}[\\w.-]*"), lacks("\\{[^}]+\\}"), holds(":?-[^{}]*\\}/g")],
  ["packages/providers/src/policy/copies.ts", "a cp or mv option cluster is not read past `S`, which takes a value (the next word, when it stands alone)", holds("/^-[a-su-zA-RT-Z]*t(.*)$/s"), holds('if (/^-[a-su-zA-RT-Z]*S$/.test(arg) || arg === "--suffix") {')],
  ["packages/providers/src/policy/shell-readings.ts", "a POSIX script holding `$'` is read both ways on every platform, each reading is made for every way its variables may be followed, and the text read is counted", holds('(win && escapes) || ansiC ? ["posix", "keep"] : ["posix"]'), holds("variableReadings(() => groupInputs(parseShell(src, dialect, mode)), scope)"), holds("spend(src.length * modes.length);")],
  ["packages/providers/src/policy/locations.ts", "cmd's `cd /d` is a switch only where cmd may be the shell, and a shell that isn't known is followed both ways", holds("if (cmdSwitch && i === 0"), holds('isWin(ctx) && shell !== "posix" && shell !== "powershell"'), holds("return refused ? [moved, ctx] : [moved];")],
  ["apps/server/src/services/factory/hold.ts", "the project manager releases only a hold it placed itself, and holding an issue a person holds doesn't make the hold its own", holds('if (by === "pm" && labelled && !own) {'), holds('if (by === "pm" && issue.labels.includes(FACTORY_HOLD_LABEL) && !own) {'), holds('const own = held.some((h) => h.issueNumber === issue.number && h.by === "pm");'), holds('const own = loop.holds.some((h) => h.issueNumber === issue.number && h.by === "pm");')],
  ["apps/server/src/mcp/tools/pm/github.ts", "the project manager's triage tool neither puts nor takes the hold label", holds("if (named.some((label) => label.trim().toLowerCase() === FACTORY_HOLD_LABEL)) {")],
  ["apps/server/src/services/updates/installer.ts", "the update install keeps a person's npm settings that only restrict versions and sources (and not `ignore_scripts`, which would leave native modules unbuilt)", holds('"min_release_age",'), holds('"before",'), holds('"allow_git",'), lacks('"ignore_scripts",')],
  // --- the vision the project manager reads: the fork's own text in a file upstream ships too
  [".codeden/VISION.md", "the fork's own vision (a conflict on this file is resolved to the fork's text)", /^CodeHarden is a hardened fork/],
];

/**
 * The credit on top of README.md: the first line and the sentence that says where the text comes
 * from. Unlike the checks above, this one and README_ALLOWED hold this repository's own prose: a
 * fork that rewrites its README for its own product changes both to match.
 */
const README_CREDIT = [
  "> **CodeHarden** is a hardened fork of [CodeDen](https://github.com/leonvanzyl/codeden)",
  "> The README below is derived and adapted from the [CodeDen repository](https://github.com/leonvanzyl/codeden).",
];

/**
 * The mentions of upstream that stay in README.md below the credit: `[section, text, reason]`,
 * where the section is the line's nearest `## ` heading. Each is upstream itself, not this
 * product. Everything else below the credit says CodeHarden and gives the fork's own command,
 * home, port and links.
 */
// biome-ignore format: one entry per line, read as a table
const README_ALLOWED = [
  ["Make your own hardened fork", /^CodeHarden follows CodeDen: /, "the upstream this fork follows"],
  ["Make your own hardened fork", /\| `UPSTREAM_REPO` \| The repository you follow \| `leonvanzyl\/codeden` \|/, "the value of UPSTREAM_REPO here: upstream's repository"],
  ["Make your own hardened fork", /its own app next to CodeHarden and CodeDen: /, "the upstream app, which a fork's app also stays apart from"],
  ["Make your own hardened fork", /The "CodeDen" wording inside the UI is not changed by any of this\./, "what the UI's ordinary sentences still say"],
  ["Make your own hardened fork", /brings upstream CodeDen's own names back/, "what this guard looks for"],
  ["Contributing", /\[CHANGELOG\.md\]\(CHANGELOG\.md\) for upstream CodeDen's own changes\./, "CHANGELOG.md is upstream's changelog; the fork's is CODEHARDEN-CHANGELOG.md"],
];

/**
 * What is wrong with README.md as a list of messages (empty when it is as the fork left it):
 * the credit is gone or changed, or a line below it names upstream (its name in any case, so
 * also its package, command, home and website, or its port) outside README_ALLOWED.
 */
function readmeProblems(text, used = new Set()) {
  const lines = text.split("\n");
  const end = lines.findIndex((line) => !line.startsWith(">"));
  const credit = lines.slice(0, end < 0 ? lines.length : end);
  const problems = [];
  if (!credit[0]?.startsWith(README_CREDIT[0])) {
    problems.push(`README.md no longer opens with the fork's credit: ${README_CREDIT[0]}`);
  }
  if (!credit.includes(README_CREDIT[1])) {
    problems.push(`README.md's credit lost its sentence: ${README_CREDIT[1]}`);
  }
  let section = "";
  for (let i = credit.length; i < lines.length; i++) {
    const heading = /^## (.+)$/.exec(lines[i]);
    if (heading) section = heading[1];
    let rest = lines[i];
    for (const entry of README_ALLOWED) {
      const [where, pattern] = entry;
      if (where !== section || !pattern.test(rest)) continue;
      used.add(entry);
      rest = rest.replace(pattern, "");
    }
    const back = /codeden|\b4317\b/i.exec(rest);
    if (back) {
      problems.push(
        `README.md:${i + 1} says \`${back[0]}\` (section "${section || "the top"}"): ${lines[i].trim().slice(0, 160)}`,
      );
    }
  }
  return problems;
}

/**
 * True when every line written as a help line (two spaces, upstream's command, a word) stands
 * inside `HELP = named(`…`)`, the one text `named()` rewrites: the ALLOWED entry for those lines
 * must not excuse one anywhere else in the file.
 */
function helpLinesOnlyInHelp(code) {
  const start = code.indexOf("export const HELP = named(`");
  const end = start < 0 ? -1 : code.indexOf("`);", start);
  if (start < 0 || end < 0) return false;
  const outside = code.slice(0, start) + code.slice(end);
  return !/^ {2}codeden (?=[a-z[])/m.test(outside);
}
helpLinesOnlyInHelp.say =
  "every help line (`  codeden <word>`) inside `HELP = named(...)`, none before or after it";

/** True when the set of variables the path rules know is the one the fork's readings are for. */
function ambientNames(code) {
  const set = /const AMBIENT = new Set\(\[([^\]]*)\]\)/.exec(code)?.[1] ?? "";
  const names = [...set.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  const want = ["CODEDEN_HOME", "HOME", "PWD", "TEMP", "TMP", "TMPDIR", "ps:home", "ps:pwd"];
  return (
    JSON.stringify(names) === JSON.stringify(want) &&
    code.includes("const ambient = (name: string): boolean => AMBIENT.has(name);")
  );
}
ambientNames.say =
  "`AMBIENT` holding HOME, PWD, TMPDIR, TEMP, TMP, CODEDEN_HOME, ps:home and ps:pwd, read through `ambient()`";

/** A check that the file's code holds `text` exactly as written (no pattern to escape). */
function holds(text) {
  const check = (code) => code.includes(text);
  check.say = `\`${text}\``;
  return check;
}

/** A check that the file's code no longer holds `text` (the form the fork replaced). */
function lacks(text) {
  const check = (code) => !code.includes(text);
  check.say = `the fork's form in place of \`${text}\``;
  return check;
}

/** True when every `define` block of a bundler config spreads the version and the channel. */
function bothDefinesInEveryBundle(code) {
  const count = (pattern) => code.match(pattern)?.length ?? 0;
  const blocks = count(/\bdefine: \{/g);
  return (
    blocks > 0 &&
    count(/\.\.\.hardenVersionDefine\(\)/g) === blocks &&
    count(/\.\.\.hardenChannelDefine\(\)/g) === blocks
  );
}
bothDefinesInEveryBundle.say =
  "`...hardenVersionDefine()` and `...hardenChannelDefine()` in every `define` block (one per bundle)";

/**
 * True when the file names the product through `HARDEN_PRODUCT_NAME` and nowhere as the fixed
 * text `CodeDen`. For the files whose every mention of the product is the thing being updated
 * (the update banner, "What's new", the update command): a new message upstream adds there
 * with its own name fails too.
 */
function productNameOnlyByConstant(code) {
  return /(?<![\w$])HARDEN_PRODUCT_NAME(?![\w$])/.test(code) && !/\bCodeDen\b/.test(code);
}
productNameOnlyByConstant.say =
  "the product's name read from `HARDEN_PRODUCT_NAME` in every message (and no fixed `CodeDen` in the file's code)";

/** True when the window's and the notifications' icon are both the product's own. */
function bothWindowIconsAreTheForks(code) {
  return (
    code.match(/icon: this\.asset\("harden\/icon\.png"\)/g)?.length === 2 &&
    !/this\.asset\("icon\.png"\)/.test(code)
  );
}
bothWindowIconsAreTheForks.say =
  '`icon: this.asset("harden/icon.png")` for the window and for notifications (and no `this.asset("icon.png")`, upstream\'s icon)';

/** A needed name or pattern as a reader would look for it in the file. */
const say = (need) =>
  typeof need === "string"
    ? need
    : typeof need === "function"
      ? need.say
      : `\`${need.source
          .replace(/^\^ \{2\}/, "")
          .replace(/\$$/, "")
          .replace(/\\(.)/g, "$1")}\``;

/** What a call site lost, in words, or null when it is as the fork left it. */
function callSiteProblem([file, what, ...needs], text) {
  if (text === null) {
    return `${file} is gone.\n    The fork changed it for: ${what}. Upstream moved, renamed or removed the file (or a conflict resolution dropped it). Find where that logic lives now, re-apply the fork's change there (it must end up reading ${needs.map(say).join(", ")}), and point this entry of CALL_SITES at the new file.`;
  }
  const code = codeLines(file, text).join("\n");
  const missing = needs.filter((need) =>
    typeof need === "string"
      ? !new RegExp(`(?<![\\w$])${need}(?![\\w$])`).test(code)
      : typeof need === "function"
        ? !need(code)
        : !need.test(code),
  );
  if (missing.length === 0) return null;
  return `${file} no longer has ${missing.map(say).join(", ")}.\n    The fork changed it for: ${what}. A merge took upstream's side here, or upstream rewrote this code: look at the file's history (git log -p -- ${file}), put the fork's change back, and check what the code uses in its place (often upstream's fixed value).`;
}

function trackedFiles() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", env });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
  return result.stdout.split("\0").filter(Boolean);
}

const read = (file) =>
  existsSync(`${ROOT}/${file}`) ? readFileSync(`${ROOT}/${file}`, "utf8") : null;
const D = "$";
const TICK = "`";
const rulesHit = (file, text) => [...new Set(scan(file, text).map((hit) => hit.rule.id))];

describe("upstream's identity does not come back into product code", () => {
  it("no product file uses an upstream identity value outside the allowed list", () => {
    const used = new Set();
    const files = trackedFiles().filter(inScope);
    expect(
      files.length,
      "the scan found almost no files: the source folders moved",
    ).toBeGreaterThan(500);
    const hits = files.flatMap((file) => scan(file, read(file) ?? "", used));
    expect(hits.length, hitReport(hits)).toBe(0);

    const stale = staleEntries(ALLOWED, used);
    expect(
      stale.length,
      `\n\nThese ALLOWED entries match nothing any more: upstream changed or removed the text. Remove each entry, or correct it if the same text only moved or changed shape.\n\n${stale.join("\n\n")}\n`,
    ).toBe(0);
  });

  it("scans what ships and builds the product, not tests or docs", () => {
    for (const file of [
      "apps/server/src/services/updates/new-check.ts",
      "apps/desktop/electron-builder.config.mjs",
      "apps/desktop/scripts/package.mjs",
      "apps/web/vite.config.ts",
      "apps/cli/package.json",
      "packages/contracts/src/harden-channel.ts",
      "apps/web/index.html",
    ]) {
      expect(inScope(file), file).toBe(true);
    }
    for (const file of [
      "apps/server/test/updates.test.ts",
      "apps/web/e2e/update.spec.ts",
      "docs/DESIGN.md",
      "CHANGELOG.md",
      "README.md",
      "scripts/harden/release.sh",
      "apps/web/vitest.config.ts",
    ]) {
      expect(inScope(file), file).toBe(false);
    }
  });

  // What an upstream merge could bring back, run through the same scanner.
  // biome-ignore format: one case per line
  it.each([
    ["the home folder in the server's paths", "apps/server/src/paths.ts", '  return join(homedir(), ".codeden");', "home-folder"],
    ["the fixed package name in the update code", "apps/server/src/services/updates/app-dir.ts", 'export const PACKAGE_NAME = "codeden";', "bare-name"],
    ["a new file that asks the registry for upstream's package", "apps/server/src/services/updates/new-check.ts", 'const res = await fetch("https://registry.npmjs.org/codeden/latest");', "npm-package"],
    ["an install command for upstream's package", "apps/server/src/services/updates/service.ts", "const manual = `npm i -g codeden@latest`;", "npm-package"],
    ["a new default port", "apps/cli/src/network-command.ts", "const DEFAULT_PORT = 4317;", "default-port"],
    ["a port fallback in a new file", "apps/desktop/src/main/new-port.ts", "const port = Number(env.PORT ?? 4317);", "default-port"],
    ["the app id in the electron-builder config", "apps/desktop/electron-builder.config.mjs", '  appId: "dev.codeden.app",', "app-id"],
    ["the product name in the electron-builder config", "apps/desktop/electron-builder.config.mjs", '  productName: "CodeDen",', "app-name"],
    ["an installer named after upstream", "apps/desktop/electron-builder.config.mjs", `    artifactName: "CodeDen-Setup-${D}{version}.${D}{ext}",`, "app-name"],
    ["the update feed of upstream's repository", "apps/desktop/electron-builder.config.mjs", '  publish: [{ provider: "github", owner: "leonvanzyl", repo: "codeden" }],', "repository"],
    ["the app's name in the desktop entry", "apps/desktop/src/main/main.ts", 'app.setName("CodeDen");', "app-name"],
    ["upstream's releases page", "apps/server/src/services/updates/desktop.ts", 'export const DESKTOP_RELEASES_URL = "https://github.com/leonvanzyl/codeden/releases/latest";', "repository"],
    ["the projects folder", "apps/server/src/services/container.ts", '    projectsDir: opts.projectsDir ?? join(userHome, "codeden-projects"),', "projects-folder"],
    ["the keychain service", "apps/server/src/services/secrets.ts", '    private readonly service = "codeden",', "bare-name"],
    ["the page title in the web app's index.html", "apps/web/index.html", "    <title>CodeDen</title>", "app-name"],
    ["the home-screen title in index.html", "apps/web/index.html", '    <meta name="apple-mobile-web-app-title" content="CodeDen" />', "app-name"],
    ["the installed web app's name in the manifest", "apps/web/public/manifest.webmanifest", '  "short_name": "CodeDen",', "app-name"],
    ["the tab title constant", "apps/web/src/lib/attention/title.ts", 'export const APP_TITLE = "CodeDen";', "app-name"],
    ["the title of a page the server writes", "apps/server/src/security.ts", "const PAGE = `<!doctype html><title>CodeDen</title>`;", "app-name"],
    ["the sandbox image's name", "apps/server/src/execution/docker/args.ts", `  return ${TICK}codeden-runner:${D}{version}${TICK};`, "sandbox-names"],
    ["a sandbox label", "apps/server/src/execution/docker/args.ts", '  install: "codeden.install",', "sandbox-names"],
    ["a label filter written by hand", "apps/server/src/execution/new-sweep.ts", 'const filter = ["--filter", "label=codeden.install"];', "sandbox-names"],
    ["the sandbox container's name", "apps/server/src/execution/docker/backend.ts", `  return ${TICK}codeden-${D}{recordId}${TICK};`, "sandbox-names"],
    ["the link scheme", "packages/contracts/src/desktop.ts", 'export const DEEP_LINK_SCHEME = "codeden";', "bare-name"],
    ["a link built by hand", "apps/web/src/lib/new-links.ts", `const link = ${TICK}codeden://session/${D}{id}${TICK};`, "link-scheme"],
    ["the home folder in a file that also names the project folder", "apps/server/src/services/automations/sources.ts", 'const dir = join(homedir(), ".codeden", "automations");', "home-folder"],
    ["a value after a string that looks like a comment start", "apps/server/src/new.ts", 'const hint = "Use /* to start a comment";\nconst port = 4317;', "default-port"],
    ["a value after a URL and before a real comment", "apps/server/src/new.ts", 'const url = "https://registry.npmjs.org/codeden"; // the package', "npm-package"],
    ["a message that tells people to run upstream's command", "apps/cli/src/network-command.ts", 'console.error("Run: codeden password");', "command-in-text"],
    ["a usage line", "apps/cli/src/new-command.ts", `const USAGE = ${TICK}Usage: codeden sync [--all]${TICK};`, "command-in-text"],
    ["an option after the command", "apps/cli/src/commands.ts", `console.error(${TICK}Port ${D}{port} is in use. Try: codeden --port ${D}{port + 1}${TICK});`, "command-in-text"],
    ["a command in a hint of the web UI", "apps/web/src/components/settings/sections-network.tsx", '            <code className="font-mono">codeden network origin add https://&lt;host&gt;</code> on', "command-in-text"],
    ["a command in a provider's error message", "packages/providers/src/claude/sdk/load.ts", '"use Settings > First-run setup, or run `codeden doctor --install`.",', "command-in-text"],
    ["a help line outside the help that is renamed", "apps/cli/src/new-help.ts", `const MORE = ${TICK}\n  codeden sync           Fetch upstream${TICK};`, "command-in-text"],
    ["a command in the help's own file but not a help line", "apps/cli/src/args.ts", 'const hint = "Run: codeden doctor";', "command-in-text"],
    ["a new message next to the runner's log prefix", "apps/runner/src/main.ts", 'console.error("codeden runner: stopped. Start it again with: codeden --home x");', "command-in-text"],
    ["an upstream value next to an allowed one", "apps/server/src/services/sessions/handoff.ts", '  send({ from: "codeden", service: "codeden" });', "bare-name"],
  ])("fails on %s", (_name, file, line, rule) => {
    expect(inScope(file), `${file} must be scanned`).toBe(true);
    expect(rulesHit(file, `import { x } from "y";\n${line}\n`)).toContain(rule);
  });

  it("leaves comments, allowed text and the fork's own values alone", () => {
    // biome-ignore format: one case per line
    const quiet = [
      [
        "apps/server/src/paths.ts",
        "/** The home, `~/.codeden` upstream. */\n// codeden://x, port 4317\n  return join(homedir(), HARDEN_HOME_DIRNAME);",
      ],
      ["apps/server/src/services/sessions/handoff.ts", '  send({ from: "codeden" });'],
      [
        "apps/runner/src/workspace/project-config.ts",
        'export const PROJECT_CONFIG_PATH = ".codeden/project.json";',
      ],
      [
        "apps/desktop/src/main/main.ts",
        'app.setName(HARDEN_PRODUCT_NAME);\nimport { x } from "@codeden/contracts";\nconst home = env.CODEDEN_HOME;',
      ],
      [
        "apps/server/src/new.ts",
        'const branch = "codeden/fix-1"; const port = 4417; const tmp = "codeden-x"; const n = 14317;',
      ],
      // The word where it is not the command: the MCP server and its tools, the folder in a
      // repository, a branch, a package, a variable, the comment marker, the product's name.
      [
        "apps/server/src/new.ts",
        [
          'const tool = "mcp__codeden__finish to end, mcp__codeden__ask_user to ask";',
          'const note = "Read .codeden/project.json first";',
          "const branch = `codeden/$" + "{slug} is the branch`;",
          'import { y } from "@codeden/contracts";',
          'const home = env.CODEDEN_HOME ?? "set CODEDEN_HOME to a folder";',
          'const marker = "<!-- codeden -->";',
          'const log = `[codeden] $' + '{message}`; const dir = "codeden-cli-net-";',
          'const text = "CodeDen is running. Open CodeDen on your phone";',
        ].join("\n"),
      ],
      // The fork's own command, and the places the upstream word stays (see ALLOWED).
      ["apps/cli/src/network-command.ts", "console.error(`Run: $" + "{HARDEN_COMMAND} password`);"],
      ["apps/cli/src/network-command.ts", 'console.error("Run: codeharden password");'],
      ["apps/cli/src/args.ts", "export const HELP = named(`x\n\nUsage:\n  codeden [options]      Start\n  codeden doctor         Check\n`);"],
      ["apps/runner/src/link/runner-link.ts", "opts.stderr.write(`codeden runner-link: $" + "{message}\\n`);"],
    ];
    for (const [file, text] of quiet) expect(scan(file, text), file).toEqual([]);
  });

  it("an entry that names two paths holds on either, and one that matches nothing is stale", () => {
    const before = "packages/x/src/session.ts";
    const after = "packages/x/src/session-open.ts";
    const line = 'const KEY = "codeden";';
    const moved = () => [allowedEntry([[before, after], /KEY = "codeden"/, "a stored key"])];
    // Before the sync the line is in the old file, after it in the new one: used either way.
    for (const file of [before, after]) {
      const allowed = moved();
      const used = new Set();
      expect(scan(file, line, used, allowed), file).toEqual([]);
      expect(staleEntries(allowed, used), file).toEqual([]);
    }
    // Both files on the way (a merge in progress) is one use, not a problem.
    const allowed = moved();
    const used = new Set();
    expect([before, after].flatMap((file) => scan(file, line, used, allowed))).toEqual([]);
    expect(staleEntries(allowed, used)).toEqual([]);
    // Only the named paths and only the entry's text: a third file, or another value in a
    // named one, is still a hit.
    expect(scan("packages/x/src/other.ts", line, new Set(), moved())).toHaveLength(1);
    expect(scan(after, 'const service = "codeden";', new Set(), moved())).toHaveLength(1);
    // The line is in neither file: the entry is stale and the report names both paths.
    const unused = new Set();
    expect(scan(before, "const KEY = HARDEN_APP_SLUG;", unused, allowed)).toEqual([]);
    expect(staleEntries(allowed, unused)).toEqual([
      `${before} | ${after}: KEY = "codeden"\n    (a stored key)`,
    ]);
    // A list may hold patterns too.
    const mixed = [allowedEntry([[/^packages\/x\/src\/a-/, before], /KEY = "codeden"/, "a key"])];
    const viaPattern = new Set();
    expect(scan("packages/x/src/a-1.ts", line, viaPattern, mixed)).toEqual([]);
    expect(staleEntries(mixed, viaPattern)).toEqual([]);
  });
});

describe("the fork's call sites are still there", () => {
  it("every file the fork redirected still reads the fork's channel", () => {
    const problems = CALL_SITES.map((site) => callSiteProblem(site, read(site[0]))).filter(Boolean);
    expect(
      problems.length,
      `\n\nThe fork's change is missing in ${problems.length} place(s). Until it is back, that part of the product uses upstream's value.\n\n${problems.join("\n\n")}\n`,
    ).toBe(0);
  });

  it("fails when a call site loses the fork's symbol or the file is gone", () => {
    const paths = CALL_SITES.find(([file]) => file === "apps/server/src/paths.ts");
    const reverted = (read(paths[0]) ?? "").replace(
      "join(homedir(), HARDEN_HOME_DIRNAME)",
      'join(homedir(), ".codeden")',
    );
    expect(callSiteProblem(paths, reverted)).toMatch(
      /paths\.ts no longer has .*HARDEN_HOME_DIRNAME/,
    );
    expect(rulesHit(paths[0], reverted)).toEqual(["home-folder"]);
    // A mention in a comment is not a use.
    expect(
      callSiteProblem(
        ["apps/x/src/a.ts", "x", "HARDEN_COMMAND"],
        "// HARDEN_COMMAND\nconst a = 1;",
      ),
    ).toMatch(/no longer has HARDEN_COMMAND/);
    expect(callSiteProblem(paths, null)).toMatch(
      /paths\.ts is gone[\s\S]*Find where that logic lives now/,
    );
    // One bundle of three losing its defines is a loss.
    const bundles = CALL_SITES.find(([file]) => file === "apps/desktop/tsdown.config.ts");
    const oneLost = (read(bundles[0]) ?? "").replace(
      "{ ...hardenVersionDefine(), ...hardenChannelDefine() }",
      "{}",
    );
    expect(callSiteProblem(bundles, oneLost)).toMatch(/in every `define` block/);
    const config = CALL_SITES.find(([file]) => file === "apps/desktop/electron-builder.config.mjs");
    const upstreamConfig = (read(config[0]) ?? "").replace(
      /^ {2}appId,$/m,
      '  appId: "dev.codeden.app",',
    );
    expect(callSiteProblem(config, upstreamConfig)).toMatch(
      /electron-builder\.config\.mjs no longer has/,
    );
  });

  it("fails when the logo or an icon goes back to upstream's", () => {
    const site = (file) => CALL_SITES.find(([path]) => path === file);
    const text = (file) => read(file) ?? "";
    // Upstream's logo component: its own path, drawn in the theme's accent.
    const logo = site("apps/web/src/components/shell/logo.tsx");
    expect(callSiteProblem(logo, text(logo[0]))).toBeNull();
    expect(
      callSiteProblem(
        logo,
        'const MARK_PATH = "M15.04 5.78L10.7 5.78Z";\nexport function Logo() {\n  return <path d={MARK_PATH} className="fill-primary" />;\n}\n',
      ),
    ).toMatch(/logo\.tsx no longer has HARDEN_MARK/);
    // The name beside it as plain text again.
    const sidebar = site("apps/web/src/components/shell/sidebar/sidebar.tsx");
    const plain = text(sidebar[0]).replace(/<Wordmark className=[^>]*\/>/, "<span>CodeDen</span>");
    expect(callSiteProblem(sidebar, plain)).toMatch(/sidebar\.tsx no longer has/);
    // The packaged app without its own icon falls back to upstream's build/icon.png.
    const config = site("apps/desktop/electron-builder.config.mjs");
    const noIcon = text(config[0]).replace('    icon: "build/harden/icon.icns",\n', "");
    expect(callSiteProblem(config, noIcon)).toMatch(/no longer has .*icon\.icns/);
    // One of the two window icons, and the tray, back on upstream's files.
    const app = site("apps/desktop/src/main/desktop-app.ts");
    const oneBack = text(app[0]).replace('this.asset("harden/icon.png")', 'this.asset("icon.png")');
    expect(callSiteProblem(app, oneBack)).toMatch(/for the window and for notifications/);
    const tray = text(app[0]).replace(
      '"harden/trayTemplate.png" : "harden/tray.png"',
      '"trayTemplate.png" : "tray.png"',
    );
    expect(callSiteProblem(app, tray)).toMatch(/desktop-app\.ts no longer has/);
    // The build step that swaps the page's and the manifest's icons.
    const identity = site("scripts/harden/web-identity.mjs");
    const noSwap = text(identity[0]).replaceAll("brandedHtml", "sameHtml");
    expect(callSiteProblem(identity, noSwap)).toMatch(/no longer has .*brandedHtml/);
  });

  it("fails when an update message names the product as the fixed CodeDen again", () => {
    const site = (file) => CALL_SITES.find(([path]) => path === file);
    const text = (file) => read(file) ?? "";
    // The banner as upstream writes it: "CodeDen 1.2.3 is available."
    const banner = site("apps/web/src/components/shell/update-banner.tsx");
    expect(callSiteProblem(banner, text(banner[0]))).toBeNull();
    const upstream = text(banner[0]).replace(
      "{HARDEN_PRODUCT_NAME} {view.version} is available.",
      "CodeDen {view.version} is available.",
    );
    expect(upstream).not.toBe(text(banner[0]));
    expect(callSiteProblem(banner, upstream)).toMatch(
      /update-banner\.tsx no longer has the product's name read from `HARDEN_PRODUCT_NAME`/,
    );
    // A new state upstream adds with its own name, the fork's lines untouched.
    const added = `${text(banner[0])}\nconst later = <span>CodeDen is up to date.</span>;\n`;
    expect(callSiteProblem(banner, added)).toMatch(/update-banner\.tsx no longer has/);
    // A mention in a comment or in an identifier is not a message.
    expect(
      productNameOnlyByConstant(
        "// CodeDen upstream\nconst a: CodeDenClient = HARDEN_PRODUCT_NAME;",
      ),
    ).toBe(false);
    expect(productNameOnlyByConstant("const a: CodeDenClient = HARDEN_PRODUCT_NAME;")).toBe(true);
    // The update command's messages and the server's.
    const command = site("apps/cli/src/update-command.ts");
    const fixed = text(command[0]).replace(/`Installing \S+ /, "`Installing CodeDen ");
    expect(fixed).not.toBe(text(command[0]));
    expect(callSiteProblem(command, fixed)).toMatch(/update-command\.ts no longer has/);
    // A source build comparing with upstream's package version again.
    const service = site("apps/server/src/services/updates/service.ts");
    const compared = text(service[0]).replace(
      "hardenUpdateBaseline(this.host.source, current, this.latest)",
      "current",
    );
    expect(compared).not.toBe(text(service[0]));
    expect(callSiteProblem(service, compared)).toMatch(/service\.ts no longer has/);
  });

  it("fails when a default the fork set differently goes back to upstream's", () => {
    const site = (file) => CALL_SITES.find(([path]) => path === file);
    const text = (file) => read(file) ?? "";
    // The settings schema as upstream writes it: the switch on by default.
    const settings = site("packages/contracts/src/settings.ts");
    expect(callSiteProblem(settings, text(settings[0]))).toBeNull();
    const upstream = text(settings[0]).replace(
      "autoSwitchOnLimit: z.boolean().default(HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT),",
      "autoSwitchOnLimit: z.boolean().default(true),",
    );
    expect(upstream).not.toBe(text(settings[0]));
    expect(callSiteProblem(settings, upstream)).toMatch(
      /settings\.ts no longer has `autoSwitchOnLimit: z\.boolean\(\)\.default\(HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT\),`/,
    );
    // The import alone is not the default.
    expect(upstream).toMatch(/import \{ HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT \}/);
    // The fork's constant flipped to on.
    const defaults = site("packages/contracts/src/harden-defaults.ts");
    expect(callSiteProblem(defaults, text(defaults[0]))).toBeNull();
    const on = text(defaults[0]).replace(
      "HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT = false;",
      "HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT = true;",
    );
    expect(on).not.toBe(text(defaults[0]));
    expect(callSiteProblem(defaults, on)).toMatch(/harden-defaults\.ts no longer has/);
    expect(callSiteProblem(defaults, null)).toMatch(/harden-defaults\.ts is gone/);
  });

  it("fails when a message names upstream's command again, or the help is no longer renamed", () => {
    const site = (file) => CALL_SITES.find(([path]) => path === file);
    const text = (file) => read(file) ?? "";
    // The network command as upstream writes it.
    const network = site("apps/cli/src/network-command.ts");
    expect(callSiteProblem(network, text(network[0]))).toBeNull();
    const upstream = text(network[0]).replaceAll("${" + "HARDEN_COMMAND}", "codeden");
    expect(upstream).not.toBe(text(network[0]));
    expect(callSiteProblem(network, upstream)).toMatch(/network-command\.ts no longer has/);
    expect(rulesHit(network[0], upstream)).toEqual(["command-in-text"]);
    // The help without `named()`: its lines are allowed text, so only the call site can tell.
    const args = site("apps/cli/src/args.ts");
    expect(callSiteProblem(args, text(args[0]))).toBeNull();
    const bare = text(args[0]).replace("export const HELP = named(`", "export const HELP = (`");
    expect(bare).not.toBe(text(args[0]));
    expect(rulesHit(args[0], bare)).toEqual([]);
    expect(callSiteProblem(args, bare)).toMatch(/args\.ts no longer has/);
    // A line shaped like a help line in another text of that file: the allowance for the help's
    // lines lets it through the scan, so the call site speaks.
    const elsewhere = `${text(args[0])}\nexport const MORE = \`\n  codeden sync           Fetch\n\`;\n`;
    expect(rulesHit(args[0], elsewhere)).toEqual([]);
    expect(callSiteProblem(args, elsewhere)).toMatch(/none before or after it/);
    // The hint in Settings.
    const hint = site("apps/web/src/components/settings/sections-network.tsx");
    const plain = text(hint[0]).replace(
      "{HARDEN_COMMAND} network origin",
      "codeden network origin",
    );
    expect(plain).not.toBe(text(hint[0]));
    expect(callSiteProblem(hint, plain)).toMatch(/sections-network\.tsx no longer has/);
    expect(rulesHit(hint[0], plain)).toEqual(["command-in-text"]);
  });

  it("fails when a fix the fork carries in upstream's file is merged away", () => {
    const site = (file) => CALL_SITES.find(([path]) => path === file);
    const text = (file) => read(file) ?? "";
    // [file, the fork's line, the line as upstream has it]
    // biome-ignore format: one case per line
    const cases = [
      ["packages/providers/src/policy/risk.ts", "  if (command.length > MAX_COMMAND_CHARS) return TOO_LONG;\n", ""],
      ["packages/providers/src/policy/inline-code.ts", "quotedSpans(read, QUOTES)", "read.matchAll(LITERAL)"],
      ["packages/providers/src/policy/risk.ts", "return bounded(() => classifyWithin(command, given), TOO_INVOLVED);", "return classifyWithin(command, given);"],
      ["packages/providers/src/policy/variables.ts", "    if (how.keepAmbient) return;\n", ""],
      ["packages/providers/src/policy/variables.ts", "how.every && copies.length > 1 ? copies : [copies[0] ?? cmd]", "[copies[0] ?? cmd]"],
      ["packages/providers/src/policy/variables.ts", '"TMPDIR",', ""],
      ["packages/providers/src/policy/variables.ts", ":?-[^{}]*\\}/g", ":?-[^}]*\\}/g"],
      ["packages/providers/src/policy/shell-readings.ts", "variableReadings(() => groupInputs(parseShell(src, dialect, mode)), scope)", "resolveVariables(groupInputs(parseShell(src, dialect, mode)), new Map(scope))"],
      ["packages/providers/src/policy/shell-readings.ts", "  spend(src.length * modes.length);\n", ""],
      ["packages/providers/src/policy/read-only.ts", "if (command.length > MAX_COMMAND_CHARS) {", "if (false) {"],
      ["packages/providers/src/policy/workdir.ts", "line.length <= MAX_COMMAND_CHARS && readsOnly(", "readsOnly("],
      ["packages/providers/src/policy/paths.ts", "\\{[^{}]*\\}/.test(raw)", "\\{[^}]*\\}/.test(raw)"],
      ["packages/providers/src/policy/inline-code.ts", "if (!WRITES.test(code) && !opensToWrite(code)) return [];", "if (!WRITES.test(code)) return [];"],
      ["packages/providers/src/policy/locations.ts", "return refused ? [moved, ctx] : [moved];", "return [moved];"],
      ["packages/providers/src/policy/locations.ts", ' && shell !== "powershell"', ""],
      ["packages/providers/src/policy/copies.ts", 'if (/^-[a-su-zA-RT-Z]*S$/.test(arg) || arg === "--suffix") {', "if (false) {"],
      ["apps/server/src/services/factory/hold.ts", 'if (by === "pm" && issue.labels.includes(FACTORY_HOLD_LABEL) && !own) {', "if (false) {"],
      ["apps/server/src/services/factory/hold.ts", 'held.some((h) => h.issueNumber === issue.number && h.by === "pm")', "held.some((h) => h.issueNumber === issue.number)"],
      ["apps/server/src/mcp/tools/pm/github.ts", "if (named.some((label) => label.trim().toLowerCase() === FACTORY_HOLD_LABEL)) {", "if (false) {"],
      ["packages/providers/src/policy/variables.ts", "mktemp(?: -d)?(?: ([\\w.-]+))?", "mktemp(?: -d)?(?: [\\w.-]*X{3,}[\\w.-]*)?"],
      ["packages/providers/src/policy/variables.ts", "\\{[^}]|", "\\{[^}]+\\}|"],
      ["packages/providers/src/policy/copies.ts", "[a-su-zA-RT-Z]", "[a-su-zA-Z]"],
      ["packages/providers/src/policy/shell-readings.ts", "(win && escapes) || ansiC ?", "win && escapes ?"],
      ["packages/providers/src/policy/locations.ts", "if (cmdSwitch && i === 0", "if (i === 0"],
      ["apps/server/src/services/factory/hold.ts", 'if (by === "pm" && labelled && !own) {', "if (false) {"],
      ["apps/server/src/services/updates/installer.ts", '  "min_release_age",\n', ""],
    ];
    // A file may have more than one entry (the installer has the channel's too): any may speak.
    const problems = (file, code) =>
      CALL_SITES.filter(([path]) => path === file)
        .map((entry) => callSiteProblem(entry, code))
        .filter(Boolean);
    for (const [file, ours, upstream] of cases) {
      expect(problems(file, text(file)), file).toEqual([]);
      const merged = text(file).replace(ours, upstream);
      expect(merged, `${file}: ${ours}`).not.toBe(text(file));
      expect(problems(file, merged).join("\n"), `${file}: ${ours}`).toMatch(/no longer has/);
    }
    expect(callSiteProblem(site("packages/providers/src/policy/harden-scan.ts"), null)).toMatch(
      /harden-scan\.ts is gone/,
    );
  });

  it("fails when the Secure Foundation option's slot disappears from the dialog", () => {
    const slot = CALL_SITES.find(([, what]) => what.startsWith("the Secure Foundation option"));
    const dialog = read(slot[0]) ?? "";
    expect(callSiteProblem(slot, dialog)).toBeNull();
    // Upstream's dialog as a merge would bring it back: the two choices and no slot.
    const upstream = dialog.replace("      <SecureFoundationSlot />\n", "");
    expect(upstream).not.toBe(dialog);
    expect(callSiteProblem(slot, upstream)).toMatch(
      /add-project-dialog\.tsx no longer has `<SecureFoundationSlot \/>`/,
    );
    // The import alone is not the option.
    expect(callSiteProblem(slot, upstream)).not.toBeNull();
    expect(callSiteProblem(slot, null)).toMatch(/add-project-dialog\.tsx is gone/);
    const status = CALL_SITES.find(([, what]) =>
      what.startsWith("the Secure Foundation setup status"),
    );
    const page = read(status[0]) ?? "";
    expect(callSiteProblem(status, page)).toBeNull();
    expect(
      callSiteProblem(status, page.replace(/ *<SecureFoundationStatus [^>]*\/>\n/, "")),
    ).toMatch(/project\.tsx no longer has/);
  });

  it("fails when a dev preview slot or registration disappears", () => {
    const site = (start) => CALL_SITES.find(([, what]) => what.startsWith(start));
    // Each fixture is the real file as a merge that took upstream's side would leave it.
    const cases = [
      [
        "the dev preview bar under",
        "      <DevPreviewBar session={session} />\n",
        /thread-view\.tsx no longer has/,
      ],
      [
        "the dev preview bar on a PM",
        /^ *<DevPreviewPmBar [^\n]*\/>\n/m,
        /role-chat\.tsx no longer has/,
      ],
      [
        "the dev preview section",
        /^ *<DevPreviewProjectSettings [^\n]*\/>\n/m,
        /project\.tsx no longer has/,
      ],
      [
        "the dev preview limits",
        /render: \(\) => <DevPreviewLimitsSettings \/>,?/,
        /settings\.tsx no longer has/,
      ],
      [
        "the web client's dev preview",
        "    devPreview: httpDevPreviewApi(http),\n",
        /http-client\.ts no longer has/,
      ],
      [
        "the dev preview routes",
        '      .route("/dev-preview", devPreviewRoutes(s))\n',
        /api\.ts no longer has/,
      ],
      ["the dev preview service", "devPreview: createDevPreview(", /container\.ts no longer has/],
      [
        "the dev preview starts",
        "      await services.devPreview.stop();\n",
        /server\.ts no longer has `await services/,
      ],
      [
        "the dev preview starts",
        "  services.devPreview.start({ port });\n",
        /server\.ts no longer has `services\.devPreview\.start/,
      ],
      ["exports the dev preview", 'export * from "./dev-preview";\n', /index\.ts no longer has/],
    ];
    for (const [start, slot, problem] of cases) {
      const entry = site(start);
      const ours = read(entry[0]) ?? "";
      expect(callSiteProblem(entry, ours), start).toBeNull();
      const upstream = ours.replace(slot, "");
      expect(upstream, start).not.toBe(ours);
      expect(callSiteProblem(entry, upstream), start).toMatch(problem);
      expect(callSiteProblem(entry, null), start).toMatch(/is gone/);
    }
    // The import alone is not the slot.
    const bar = site("the dev preview bar under");
    expect(
      callSiteProblem(
        bar,
        'import { DevPreviewBar } from "@/components/harden/dev-preview/bar";\n',
      ),
    ).not.toBeNull();
    // The route module must keep its this-computer-only check.
    const routes = site("setting commands and starting previews");
    const module = read(routes[0]) ?? "";
    expect(callSiteProblem(routes, module)).toBeNull();
    expect(callSiteProblem(routes, module.replaceAll("requireLocal", "anyone"))).toMatch(
      /dev-preview\.ts no longer has requireLocal/,
    );
  });

  it("fails when the vision file goes back to upstream's", () => {
    const vision = CALL_SITES.find(([file]) => file === ".codeden/VISION.md");
    const ours = read(vision[0]) ?? "";
    expect(callSiteProblem(vision, ours)).toBeNull();
    // A sync resolved to upstream's side: its first line, whatever follows.
    const upstream =
      "CodeDen is the ultimate tool for Agentic Coding.\n- It has support for all major providers.\n";
    expect(callSiteProblem(vision, upstream)).toMatch(
      /VISION\.md no longer has `\^CodeHarden is a hardened fork`/,
    );
    // The fork's sentence further down is not the fork's vision: it must open the file.
    expect(callSiteProblem(vision, `${upstream}${ours}`)).not.toBeNull();
    expect(callSiteProblem(vision, null)).toMatch(/VISION\.md is gone/);
  });
});

describe("the README keeps the fork's wording", () => {
  const ours = read("README.md") ?? "";
  const HOW =
    "\n\nA sync brought upstream's README text back. README conflicts resolve to the fork's wording; carry upstream's content changes over by hand: say CodeHarden where the text means this product, with the fork's command, home, port and links (packages/contracts/src/harden-channel.ts). A mention that really is upstream gets a README_ALLOWED entry with its reason.\n\n";

  it("has the credit on top and names upstream below it only where listed", () => {
    const used = new Set();
    const problems = readmeProblems(ours, used);
    expect(problems.length, `${HOW}${problems.join("\n")}\n`).toBe(0);
    const stale = README_ALLOWED.filter((entry) => !used.has(entry)).map(
      ([section, pattern]) => `${section}: ${pattern}`,
    );
    expect(
      stale.length,
      `\n\nThese README_ALLOWED entries match nothing any more. Remove each, or correct it if the text only changed shape.\n\n${stale.join("\n")}\n`,
    ).toBe(0);
  });

  // biome-ignore format: one case per line
  it.each([
    ["upstream's title", (t) => t.replace("\n# CodeHarden\n", "\n# CodeDen\n"), /says `CodeDen` \(section "the top"\): # CodeDen/],
    ["upstream's command", (t) => t.replace("npx codeharden\n", "npx codeden\n"), /says `codeden`/],
    ["upstream's website badge", (t) => t.replace("](https://codeharden.app)", "](https://www.codeden.app)"), /says `codeden`/],
    ["upstream's home folder", (t) => t.replace("in `~/.codeharden/`.", "in `~/.codeden/`."), /says `codeden` \(section "FAQ"\)/],
    ["upstream's port", (t) => `${t}\nIt listens on port 4317.\n`, /says `4317`/],
    ["a new paragraph of upstream's", (t) => t.replace("## FAQ\n", "## FAQ\n\nCodeDen now does more.\n"), /says `CodeDen` \(section "FAQ"\): CodeDen now does more\./],
    ["an allowed sentence in another section", (t) => t.replace("## FAQ\n", "## FAQ\n\nCodeHarden follows CodeDen: daily.\n"), /says `CodeDen` \(section "FAQ"\)/],
    ["a second mention on an allowed line", (t) => t.replace("CodeHarden follows CodeDen: ", "CodeHarden follows CodeDen: CodeDen is "), /says `CodeDen` \(section "Make your own hardened fork"\)/],
    ["the credit sentence dropped", (t) => t.replace(`${README_CREDIT[1]}\n`, ""), /credit lost its sentence/],
    ["upstream's sentence in the credit again", (t) => t.replace(README_CREDIT[1], "> Everything below is CodeDen's own README."), /credit lost its sentence/],
    ["upstream's whole README", () => "<div align=\"center\">\n\n# CodeDen\n\n</div>\n", /no longer opens with the fork's credit/],
  ])("fails on %s", (_what, change, message) => {
    const changed = change(ours);
    expect(changed).not.toBe(ours);
    expect(readmeProblems(changed).join("\n")).toMatch(message);
  });
});
