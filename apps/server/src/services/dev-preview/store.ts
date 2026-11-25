import { chmodSync } from "node:fs";
import { join } from "node:path";
import {
  type DevPreviewConfig,
  DevPreviewConfig as DevPreviewConfigSchema,
  DevPreviewLimits,
  type DevPreviewSettings,
  defaultDevPreviewLimits,
} from "@codeden/contracts";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../json-file";

/**
 * Where the dev preview keeps what people set: `<home>/dev-preview.json`.
 *
 * It is a file of its own on purpose. A project's dev command is something the app will run,
 * so it is not a field of `Project`: the project settings API and the orchestrator's
 * `update_project` tool can change a project, and neither may ever choose a command. The only
 * writer is `DevPreviewService.setProject`, behind a route that is refused to other devices
 * and needs the person's confirmation. Agents are kept out of the app's home (§15).
 */
const StoreFile = z.object({
  limits: DevPreviewLimits.optional(),
  projects: z.record(z.string(), z.unknown()).default({}),
});

export class DevPreviewStore {
  private readonly file: string;
  private limitsValue: DevPreviewLimits;
  private readonly configs = new Map<string, DevPreviewConfig>();

  constructor(home: string) {
    this.file = join(home, "dev-preview.json");
    const parsed = StoreFile.safeParse(readJsonFile(this.file));
    this.limitsValue = parsed.success
      ? (parsed.data.limits ?? defaultDevPreviewLimits())
      : defaultDevPreviewLimits();
    if (!parsed.success) return;
    for (const [projectId, raw] of Object.entries(parsed.data.projects)) {
      // An entry this build can't read is treated as never confirmed: nothing runs from it.
      const config = DevPreviewConfigSchema.safeParse(raw);
      if (config.success) this.configs.set(projectId, config.data);
    }
  }

  limits(): DevPreviewLimits {
    return this.limitsValue;
  }

  setLimits(limits: DevPreviewLimits): DevPreviewLimits {
    this.limitsValue = DevPreviewLimits.parse(limits);
    this.write();
    return this.limitsValue;
  }

  /** The project's confirmed settings, or null: no command was ever confirmed for it. */
  config(projectId: string): DevPreviewConfig | null {
    return this.configs.get(projectId) ?? null;
  }

  projectIds(): string[] {
    return [...this.configs.keys()];
  }

  /** Store settings a person just confirmed. */
  confirm(
    projectId: string,
    settings: DevPreviewSettings,
    at: Date,
    baseBranch: string | null,
  ): DevPreviewConfig {
    const config = DevPreviewConfigSchema.parse({
      ...settings,
      confirmedAt: at.toISOString(),
      baseBranch,
    });
    this.configs.set(projectId, config);
    this.write();
    return config;
  }

  /** The PM thread's preview on or off. Commands are untouched, so this confirms nothing. */
  setPmEnabled(projectId: string, enabled: boolean): DevPreviewConfig | null {
    const current = this.configs.get(projectId);
    if (!current) return null;
    const next = { ...current, pmEnabled: enabled };
    this.configs.set(projectId, next);
    this.write();
    return next;
  }

  remove(projectId: string): boolean {
    const had = this.configs.delete(projectId);
    if (had) this.write();
    return had;
  }

  private write(): void {
    writeJsonFile(
      this.file,
      { limits: this.limitsValue, projects: Object.fromEntries(this.configs) },
      0o600,
    );
    try {
      chmodSync(this.file, 0o600);
    } catch {
      // Windows: the profile's own access rules apply.
    }
  }
}
