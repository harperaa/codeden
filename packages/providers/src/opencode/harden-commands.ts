/**
 * CodeHarden: slash commands in OpenCode sessions are sent as plain prompts in this fork for now.
 *
 * The commands OpenCode lists for a session are dropped before they are reported or routed
 * (`./commands`), so nothing goes to OpenCode's command route and `/<name>` reaches the model as
 * the text it is. Skills are unaffected: the `/` menu lists them and a named one is attached to
 * the prompt as before.
 */

let run = false;

/** The commands OpenCode listed that this build reports and runs: none for now. */
export function hardenListedCommands<T>(commands: T[]): T[] {
  return run ? commands : [];
}

/**
 * Switch the command route on or off, for the tests of the route only. Nothing in the product
 * calls this (`test/harden-opencode-commands.test.ts` checks it).
 */
export function runOpenCodeCommandsInTests(on: boolean): void {
  run = on;
}
