import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type Automation,
  HARDEN_SYNC_AUTOMATIONS,
  HARDEN_SYNC_TEMPLATES_DIRNAME,
  type Project,
} from "@codeden/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { events } from "../../db/schema";
import { type AutomationDefinitions, starterId } from "../automations/definitions";
import { type ParsedAutomationFile, parseAutomationMarkdown } from "../automations/templates";
import { errorMessage } from "../errors";
import { isHardenedForkCheckout } from "./checkout";

export interface HardenSyncAutomationsDeps {
  db: Db;
  /** The projects to look at (archived ones are skipped). */
  projects: { list(): Project[] };
  definitions: AutomationDefinitions;
  /** The folder of the shipped definitions (found beside the built-in templates when omitted). */
  dir?: string;
  log?: (message: string) => void;
}

/**
 * The shipped definitions' folder: `dist/templates/harden-sync` next to the bundle (the CLI's
 * and the desktop app's builds both copy the server's whole `templates/` folder there), or
 * `apps/server/templates/harden-sync` in the workspace.
 */
export function findHardenSyncDir(explicit?: string): string | null {
  const here = import.meta.dirname;
  const candidates = [
    explicit,
    resolve(here, "templates", HARDEN_SYNC_TEMPLATES_DIRNAME),
    resolve(here, "../../../templates", HARDEN_SYNC_TEMPLATES_DIRNAME),
  ].filter((c): c is string => Boolean(c));
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * Read the shipped definitions: exactly the files `HARDEN_SYNC_AUTOMATIONS` names, each with the
 * work key the list gives it. A file that is missing, invalid or has another work key is left
 * out and reported, never guessed at.
 */
export function readHardenSyncDefinitions(
  dir: string,
  log?: (message: string) => void,
): ParsedAutomationFile[] {
  const out: ParsedAutomationFile[] = [];
  for (const { id, workKey } of HARDEN_SYNC_AUTOMATIONS) {
    try {
      const parsed = parseAutomationMarkdown(readFileSync(join(dir, `${id}.md`), "utf8"), id);
      if (parsed.workKey !== workKey) throw new Error(`its work key is not ${workKey}`);
      out.push(parsed);
    } catch (error) {
      log?.(`automations: upstream-sync review ${id}: ${errorMessage(error)}`);
    }
  }
  return out;
}

/**
 * The two upstream-sync review automations (`docs/codeharden-sync-cooldown.md`): given, switched
 * off, to every project whose folder is a checkout of a hardened fork, and to no other project.
 * They are not templates: they are not in the gallery and not part of the starter set, so
 * nothing adds or enables them for a project that isn't recognised, and "Enable starter set"
 * never switches them on. A person switches each one on.
 *
 * A project gets each one once, as a database automation `starter:<projectId>:<id>` it can edit:
 * - not while an automation of the project (or one for all projects) already runs under the same
 *   work key: an instance that had them made by hand keeps those, and never runs a review twice;
 * - not again after a person deleted it (the event log remembers).
 */
export class HardenSyncAutomations {
  private readonly shipped: ParsedAutomationFile[];

  constructor(private readonly deps: HardenSyncAutomationsDeps) {
    const dir = findHardenSyncDir(deps.dir);
    this.shipped = dir ? readHardenSyncDefinitions(dir, deps.log) : [];
    if (!dir) deps.log?.("automations: the upstream-sync review definitions were not found");
  }

  /** The shipped definitions as read (tests and the list of what would be offered). */
  definitions(): readonly ParsedAutomationFile[] {
    return this.shipped;
  }

  /** Add what is missing to every recognised project. Returns the automations created, all off. */
  offer(): Automation[] {
    if (this.shipped.length === 0) return [];
    const created: Automation[] = [];
    const existing = this.deps.definitions.all();
    for (const project of this.deps.projects.list()) {
      if (project.archivedAt || !project.isGitRepo) continue;
      const free = this.shipped.filter((def) => !this.isTaken(def, project, existing));
      // The files are read only when there is something to add, the event log after that.
      if (free.length === 0 || !isHardenedForkCheckout(project.path)) continue;
      for (const def of free) {
        if (this.wasDeleted(starterId(project.id, def.id))) continue;
        created.push(
          this.deps.definitions.create(
            {
              projectId: project.id,
              name: def.frontmatter.name,
              description: def.frontmatter.description ?? null,
              trigger: def.frontmatter.trigger,
              action: def.action,
              guards: def.guards,
              workKey: def.workKey,
              enabled: false,
            },
            { id: starterId(project.id, def.id) },
          ),
        );
      }
    }
    return created;
  }

  /** The project has its copy, or another automation that runs under the same work key. */
  private isTaken(def: ParsedAutomationFile, project: Project, existing: Automation[]): boolean {
    const id = starterId(project.id, def.id);
    return existing.some(
      (a) =>
        a.id === id ||
        (a.workKey === def.workKey &&
          (a.target.type === "all_projects" || a.target.projectId === project.id)),
    );
  }

  /** A person deleted this project's copy before: it stays gone. */
  private wasDeleted(automationId: string): boolean {
    const row = this.deps.db
      .select({ seq: events.seq })
      .from(events)
      .where(
        and(
          eq(events.type, "automation.deleted"),
          sql`json_extract(${events.payload}, '$.automationId') = ${automationId}`,
        ),
      )
      .limit(1)
      .get();
    return row !== undefined;
  }
}
