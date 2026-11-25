import { parseArgs } from "node:util";
import {
  formatHardenVersion,
  HARDEN_COMMAND,
  HARDEN_DEFAULT_PORT,
  HARDEN_HOME_DISPLAY,
} from "@codeden/contracts";

export const DEFAULT_PORT = HARDEN_DEFAULT_PORT;

/** The help text below, with its commands named after the channel's command (`HARDEN_COMMAND`). */
const named = (help: string) =>
  help
    .replaceAll("\n  codeden", `\n  ${HARDEN_COMMAND}`)
    .replaceAll(`\n${" ".repeat(25)}`, `\n${" ".repeat(18 + HARDEN_COMMAND.length)}`);

export const HELP = named(`${formatHardenVersion()}: a local-first harness for coding agents

Usage:
  codeden [options]      Start CodeDen and open it in the browser
  codeden doctor         Check the installation (--install: add Claude Code support now)
  codeden update         Install the latest version and switch to it (--rollback: go back)
  codeden stop           Stop the server and the runner
  codeden password       Set the network access password (--generate: make one up)
  codeden network on|off Let phones on your network open CodeDen, or stop it
                         (on --loopback-only: stay on 127.0.0.1 behind a proxy such as Tailscale Serve)
  codeden network origin add|remove|list <https-url>
                         HTTPS addresses of a proxy on this computer that CodeDen trusts
  codeden runner-link    Connect stdin/stdout to the runner in --home (run by the server
                         inside a sandbox; stdout carries only protocol frames)

Options:
  --port <n>     Port to listen on (default ${DEFAULT_PORT})
  --home <dir>   Data directory (default ${HARDEN_HOME_DISPLAY}, or CODEDEN_HOME)
  --no-open      Do not open the browser
  -v, --version  Print the version
  -h, --help     Show this help
`);

/** The command line; throws on an unknown option. */
export function parseCli(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      home: { type: "string" },
      "no-open": { type: "boolean", default: false },
      install: { type: "boolean", default: false },
      rollback: { type: "boolean", default: false },
      generate: { type: "boolean", default: false },
      "loopback-only": { type: "boolean", default: false },
      version: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
}

export type ParsedCli = ReturnType<typeof parseCli>;
