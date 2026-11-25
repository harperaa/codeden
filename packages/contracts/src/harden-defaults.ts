/**
 * Defaults CodeHarden sets differently from upstream CodeDen. Each is read by upstream's own
 * schema in place of its fixed value, so the logic stays upstream's and only the default is the
 * fork's. A person can still change every one of them in Settings.
 *
 * No imports, on purpose: this module only holds values.
 */

/**
 * The default of `settings.providers.autoSwitchOnLimit` ("Switch provider automatically when a
 * limit is hit", Settings › Providers). Upstream ships it on. CodeHarden ships it off: with it
 * on, the orchestrator's or a project manager's prompt and the message that failed go to
 * another provider without anybody choosing that at the moment. An install whose settings file
 * has no value for it (every install from before the setting existed) gets this default.
 */
export const HARDEN_AUTO_SWITCH_ON_LIMIT_DEFAULT = false;
