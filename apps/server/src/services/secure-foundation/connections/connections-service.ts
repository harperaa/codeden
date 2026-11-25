import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isLoginRunning,
  type SecureFoundationConnection,
  type SecureFoundationLogin,
  type SecureFoundationService,
} from "@codeden/contracts";
import { conflict, notFound } from "../../errors";
import { type Command, SERVICE_COMMANDS, type ServiceCommands } from "./commands";
import { type CliProcess, type CliResult, minimalEnv, runCli, startCli } from "./process";
import { toolPath } from "./tool-path";

export interface ConnectionsDeps {
  /** The environment the CLIs' minimal one is taken from (tests pass a PATH of fake CLIs). */
  env?: () => NodeJS.ProcessEnv;
  commands?: Record<SecureFoundationService, ServiceCommands>;
  /** How long a login may wait for the person (five minutes). */
  loginTimeoutMs?: number;
  /** Where the scratch folder the CLIs run in is made (the OS temp folder). */
  tmpDir?: string;
  /**
   * The PATH the person's own shell sets up, asked for at every check (tests script it). It is
   * how `npx` is found when the app was started from the Dock with the system's bare PATH.
   */
  shellPath?: (env: NodeJS.ProcessEnv, cwd: string) => Promise<string>;
  /** The usual install folders added after it (tests pass none, so no real tool is reached). */
  usualFolders?: string[];
}

const LOGIN_TIMEOUT_MS = 5 * 60_000;
/** Finished logins are kept this long so the form can read how they ended. */
const KEEP_FINISHED_MS = 10 * 60_000;
// biome-ignore lint/suspicious/noControlCharactersInRegex: colour codes are control characters
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

interface Running {
  login: SecureFoundationLogin;
  cli: CliProcess;
  output: string;
  timer: NodeJS.Timeout;
  endedAt: number | null;
}

/**
 * Sign-in state and logins of the services' own CLIs, for the sign-in checks. Nothing a CLI
 * prints is logged or stored: a login's link and code live in memory until the form reads them,
 * and are gone with the server.
 */
export class ConnectionsService {
  private readonly logins = new Map<string, Running>();
  private scratch: string | null = null;
  private hooked = false;
  /** Logins being started, by service: a second request joins the first instead of racing it. */
  private readonly starting = new Map<SecureFoundationService, Promise<SecureFoundationLogin>>();

  constructor(private readonly deps: ConnectionsDeps = {}) {}

  private get commands() {
    return this.deps.commands ?? SERVICE_COMMANDS;
  }

  /** The CLIs' environment, with a PATH read afresh so a tool installed a moment ago is found. */
  private async env(): Promise<NodeJS.ProcessEnv> {
    const env = minimalEnv(this.deps.env?.() ?? process.env);
    return {
      ...env,
      PATH: await toolPath(env, this.cwd(), this.deps.shellPath, this.deps.usualFolders),
    };
  }

  /** An empty folder that isn't a project: no CLI picks up a project's configuration there. */
  private cwd(): string {
    this.scratch ??= mkdtempSync(join(this.deps.tmpDir ?? tmpdir(), "connections-"));
    return this.scratch;
  }

  /** Ask each service's CLI whether this computer is signed in. */
  async states(services: SecureFoundationService[]): Promise<SecureFoundationConnection[]> {
    return Promise.all([...new Set(services)].map((service) => this.state(service)));
  }

  private async state(service: SecureFoundationService): Promise<SecureFoundationConnection> {
    const commands = this.commands[service];
    const env = await this.env();
    const result = await runCli(commands.status.program, commands.status.args, {
      cwd: this.cwd(),
      env,
      timeoutMs: commands.statusTimeoutMs,
    });
    if (result.notFound) {
      return {
        service,
        cli: "missing",
        signedIn: null,
        message: commands.missing,
        install: commands.install,
        teams: [],
        account: null,
        owners: [],
        lastOwner: null,
        missingScopes: [],
        scopes: [],
      };
    }
    const clean = (r: typeof result) => ({ ...r, output: r.output.replace(ANSI, "") });
    let reading = commands.readStatus(clean(result), null);
    if (reading.signedIn === true && commands.extra) {
      const extra = await runCli(commands.extra.program, commands.extra.args, {
        cwd: this.cwd(),
        env,
        timeoutMs: commands.statusTimeoutMs,
      });
      reading = commands.readStatus(clean(result), clean(extra));
    }
    const missing = reading.missingScopes ?? [];
    const message =
      reading.signedIn === true
        ? missing.length > 0
          ? `Signed in to ${commands.label}, but without the ${missing.join(", ")} permission the deploy needs.`
          : `Signed in to ${commands.label}.`
        : reading.signedIn === false
          ? `Not signed in to ${commands.label}.`
          : `${commands.label} couldn't be checked${result.timedOut ? " (it took too long)" : ""}. ${commands.manual}`;
    return {
      service,
      cli: "ready",
      account: null,
      owners: [],
      lastOwner: null,
      missingScopes: [],
      scopes: [],
      ...reading,
      message,
      install: null,
    };
  }

  /**
   * Run another of the product's own fixed commands the way the checks above run theirs:
   * without a shell, with the minimal environment and the person's PATH, in the scratch folder
   * that isn't a project. For commands that only read (the names of a repository's secrets).
   * Nothing it prints is logged or stored here.
   */
  async run(command: Command, timeoutMs: number): Promise<CliResult> {
    return runCli(command.program, command.args, {
      cwd: this.cwd(),
      env: await this.env(),
      timeoutMs,
    });
  }

  /**
   * The same for several commands at once, each with the same deadline. The person's PATH is
   * read once for all of them.
   */
  async runAll(commands: readonly Command[], timeoutMs: number): Promise<CliResult[]> {
    const env = await this.env();
    return Promise.all(
      commands.map((c) => runCli(c.program, c.args, { cwd: this.cwd(), env, timeoutMs })),
    );
  }

  /** Start a service's login, or join the one that is starting or running for it. */
  startLogin(service: SecureFoundationService): Promise<SecureFoundationLogin> {
    const starting = this.starting.get(service);
    if (starting) return starting;
    const started = this.begin(service).finally(() => this.starting.delete(service));
    this.starting.set(service, started);
    return started;
  }

  private async begin(service: SecureFoundationService): Promise<SecureFoundationLogin> {
    this.forget();
    for (const running of this.logins.values()) {
      if (running.login.service === service && isLoginRunning(running.login)) return running.login;
    }
    // A login must not outlive the server that started it.
    if (!this.hooked) {
      this.hooked = true;
      process.once("exit", () => this.dispose());
    }
    const commands = this.commands[service];
    // Signed in but short of a permission: add it, instead of signing in again.
    let command = commands.login;
    if (commands.refresh) {
      const now = await this.state(service);
      if (now.signedIn === true && now.missingScopes.length > 0) command = commands.refresh;
    }
    const id = randomUUID();
    const record: Running = {
      login: {
        id,
        service,
        status: "starting",
        url: null,
        code: null,
        message: `Starting the ${commands.label} sign-in…`,
      },
      cli: { child: null, kill: () => {} },
      output: "",
      timer: setTimeout(
        () => this.end(id, "timed_out"),
        this.deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS,
      ),
      endedAt: null,
    };
    this.logins.set(id, record);
    record.cli = startCli(command.program, command.args, {
      cwd: this.cwd(),
      env: await this.env(),
      onOutput: (text) => this.read(id, text),
    });
    if (!record.cli.child) {
      this.end(id, "failed", commands.missing);
      throw conflict(record.login.message, "cli_missing");
    }
    record.cli.child.on("error", () => this.end(id, "failed"));
    record.cli.child.on("close", (code) => this.end(id, code === 0 ? "done" : "failed"));
    return record.login;
  }

  /** A login as it stands now. */
  login(id: string): SecureFoundationLogin {
    const record = this.logins.get(id);
    if (!record) throw notFound("That sign-in is over", "login_not_found");
    return record.login;
  }

  /** Stop a login. Its process and everything it started are gone when this returns. */
  cancel(id: string): SecureFoundationLogin {
    this.login(id);
    this.end(id, "cancelled");
    return this.login(id);
  }

  /** Stop every login (the server is closing). */
  dispose(): void {
    for (const id of this.logins.keys()) this.end(id, "cancelled");
    this.logins.clear();
    if (this.scratch) rmSync(this.scratch, { recursive: true, force: true });
    this.scratch = null;
  }

  private read(id: string, text: string): void {
    const record = this.logins.get(id);
    if (!record || !isLoginRunning(record.login)) return;
    if (record.output.length < 50_000) record.output += text.replace(ANSI, "");
    const commands = this.commands[record.login.service];
    const { url, code } = commands.readLogin(record.output);
    if (!url) return;
    record.login = {
      ...record.login,
      status: "waiting",
      url,
      code: code ?? record.login.code,
      message: `Open the link to sign in to ${commands.label}. This waits until you have.`,
    };
  }

  private end(id: string, status: "done" | "failed" | "cancelled" | "timed_out", why?: string) {
    const record = this.logins.get(id);
    if (!record || !isLoginRunning(record.login)) return;
    clearTimeout(record.timer);
    record.cli.kill();
    const commands = this.commands[record.login.service];
    const message = {
      done: `Signed in to ${commands.label}.`,
      failed: why ?? `The ${commands.label} sign-in didn't finish. ${commands.manual}`,
      cancelled: `The ${commands.label} sign-in was cancelled.`,
      timed_out: `The ${commands.label} sign-in timed out. Start it again when you're ready.`,
    }[status];
    // The link and the code are of no use once it is over.
    record.login = { ...record.login, status, url: null, code: null, message };
    record.output = "";
    record.endedAt = Date.now();
  }

  private forget(): void {
    const now = Date.now();
    for (const [id, record] of this.logins) {
      if (record.endedAt !== null && now - record.endedAt > KEEP_FINISHED_MS)
        this.logins.delete(id);
    }
  }
}
