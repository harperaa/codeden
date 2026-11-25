import { chmodSync } from "node:fs";
import { join } from "node:path";
import {
  SECURE_FOUNDATION_NO_DEV_PREVIEW,
  type SecureFoundationDevPreview,
  type SecureFoundationSecrets,
  SecureFoundationSetupRecord,
  secureFoundationDevPreview,
  secureFoundationSetupRecord,
} from "@codeden/contracts";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../json-file";

/**
 * What the app keeps about the projects Secure Foundation created:
 * `<home>/secure-foundation.json`, by project id. It holds the answers of the setup form that a
 * dev preview depends on (the secrets mode, and with Doppler the project and config names made
 * from the project's name). Names only: no secret is ever written here.
 *
 * It also keeps the GitHub owner chosen for the last deploy (an account or organisation name), so
 * the form can preselect it next time, as the template's `/deploy-to-dev` asks for the owner
 * every time (its Step 1.5).
 *
 * The only writer is `SecureFoundationService.create`, with the form the person confirmed with
 * Go. The readers are the suggestion for the dev preview's settings form
 * (`secureFoundationDevPreview`), which a person still has to save and confirm there, and the
 * form's owner preselection. The file sits in the app's home, which agents are kept out of like
 * the app's other files.
 */
const StoreFile = z.object({
  projects: z.record(z.string(), z.unknown()).default({}),
  lastDeployOwner: z.unknown().optional(),
});

/** A GitHub account or organisation name, as the deploy's owner is checked. */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

export class SecureFoundationSetups {
  private readonly file: string;
  private readonly records = new Map<string, SecureFoundationSetupRecord>();
  private lastOwner: string | null = null;

  constructor(home: string) {
    this.file = join(home, "secure-foundation.json");
    const parsed = StoreFile.safeParse(readJsonFile(this.file));
    if (!parsed.success) return;
    const owner = parsed.data.lastDeployOwner;
    if (typeof owner === "string" && OWNER.test(owner)) this.lastOwner = owner;
    for (const [projectId, raw] of Object.entries(parsed.data.projects)) {
      // An entry this build can't read is treated as never kept.
      const record = SecureFoundationSetupRecord.safeParse(raw);
      if (record.success) this.records.set(projectId, record.data);
    }
  }

  /** What was kept for the project; null for any other project, and for one made earlier. */
  get(projectId: string): SecureFoundationSetupRecord | null {
    return this.records.get(projectId) ?? null;
  }

  /** The GitHub owner chosen for the last deploy; null when no setup with a deploy was kept. */
  lastDeployOwner(): string | null {
    return this.lastOwner;
  }

  /**
   * Keep the answers of a setup that was just created. It never throws: a project whose
   * answers couldn't be written is, after a restart, offered what a project made before
   * anything was kept is offered, and its setup is not failed over that.
   */
  record(
    projectId: string,
    answers: { name: string; secrets: SecureFoundationSecrets; deploy?: { owner: string } },
    at: Date,
  ): SecureFoundationSetupRecord {
    const record = secureFoundationSetupRecord(answers, at);
    this.records.set(projectId, record);
    const owner = answers.deploy?.owner;
    if (owner && OWNER.test(owner)) this.lastOwner = owner;
    try {
      writeJsonFile(
        this.file,
        {
          projects: Object.fromEntries(this.records),
          ...(this.lastOwner ? { lastDeployOwner: this.lastOwner } : {}),
        },
        0o600,
      );
      chmodSync(this.file, 0o600);
    } catch {
      // Not written (or, on Windows, not narrowed: the profile's own access rules apply).
    }
    return record;
  }
}

/**
 * What the dev preview's settings form is filled with for a project
 * (`secureFoundationDevPreview`): a suggestion, built from what was kept when it was created.
 * `setUp` says whether the project has a setup session, for one made before anything was kept;
 * any other project gets nothing. It stores nothing and starts nothing: the form's own Save and
 * its confirmation do.
 */
export function devPreviewOffer(
  setups: Pick<SecureFoundationSetups, "get"> | undefined,
  projectId: string,
  known: { setUp: () => boolean; baseCheckout: string | null },
): SecureFoundationDevPreview {
  const kept = setups?.get(projectId) ?? null;
  if (!kept && !known.setUp()) return SECURE_FOUNDATION_NO_DEV_PREVIEW;
  return secureFoundationDevPreview(kept, { baseCheckout: known.baseCheckout });
}
