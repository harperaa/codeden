import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Automation, FactoryLimits, type Project } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../src/db/client";
import { EventStore } from "../src/events/store";
import { AutomationService } from "../src/services/automations/automation-service";
import { starterId } from "../src/services/automations/definitions";
import { type CronSchedule, staggeredCron } from "../src/services/harden/starter-stagger";
import { InboxService } from "../src/services/inbox-service";
import { ProjectService } from "../src/services/projects/project-service";
import { SettingsStore } from "../src/settings-store";
import { removeTree } from "./support/remove-tree";

const at = (...expressions: string[]): CronSchedule[] =>
  expressions.map((expression) => ({ expression }));

describe("staggeredCron: the next free 10-minute slot for a new project's starter", () => {
  it("gives the first project the template's time and the next ones +10, +20", () => {
    expect(staggeredCron({ expression: "0 3 * * 1" }, [])).toBe("0 3 * * 1");
    expect(staggeredCron({ expression: "0 3 * * 1" }, at("0 3 * * 1"))).toBe("10 3 * * 1");
    expect(staggeredCron({ expression: "0 3 * * 1" }, at("0 3 * * 1", "10 3 * * 1"))).toBe(
      "20 3 * * 1",
    );
  });

  it("reuses the gap an archived project left", () => {
    expect(staggeredCron({ expression: "0 3 * * 1" }, at("0 3 * * 1", "20 3 * * 1"))).toBe(
      "10 3 * * 1",
    );
    expect(staggeredCron({ expression: "0 3 * * 1" }, at("10 3 * * 1", "20 3 * * 1"))).toBe(
      "0 3 * * 1",
    );
  });

  it("gives a sixth project the slot after five staggered by hand", () => {
    const five = (hour: number, days: string) =>
      at(...[0, 10, 20, 30, 40].map((minute) => `${minute} ${hour} * * ${days}`));
    expect(staggeredCron({ expression: "0 8 * * 1-5" }, five(8, "1-5"))).toBe("50 8 * * 1-5");
    expect(staggeredCron({ expression: "0 4 * * 4" }, five(4, "4"))).toBe("50 4 * * 4");
    expect(staggeredCron({ expression: "0 3 * * 1" }, five(3, "1"))).toBe("50 3 * * 1");
    // Dependency updates: four copies by hand, in whatever order the projects come.
    const deps = at("10 5 * * 2", "0 5 * * 2", "30 5 * * 2", "20 5 * * 2");
    expect(staggeredCron({ expression: "0 5 * * 2" }, deps)).toBe("40 5 * * 2");
  });

  it("carries the minute into the hour and leaves days and cadence alone", () => {
    const taken = at(
      ...[0, 10, 20, 30, 40, 50, 60].map((m) => `${m % 60} ${5 + (m >= 60 ? 1 : 0)} * * 2`),
    );
    expect(staggeredCron({ expression: "0 5 * * 2" }, taken)).toBe("10 6 * * 2");
    expect(staggeredCron({ expression: "55 4 1,15 */2 *" }, at("55 4 * * *"))).toBe(
      "5 5 1,15 */2 *",
    );
  });

  it("judges a slot by the time a copy has now, whatever days it runs on", () => {
    // A person moved one copy to 03:10 on another day and one away from the slots entirely.
    expect(
      staggeredCron({ expression: "0 3 * * 1" }, at("0 3 * * 1", "10 3 * * 5", "7 9 * * 1")),
    ).toBe("20 3 * * 1");
  });

  it("moves every hour of a plain list by the same offset", () => {
    expect(staggeredCron({ expression: "0 11,15 * * *" }, [])).toBe("0 11,15 * * *");
    expect(staggeredCron({ expression: "0 11,15 * * *" }, at("0 11,15 * * *"))).toBe(
      "10 11,15 * * *",
    );
    // 15:10 is taken by a copy someone moved, so +10 is not free for the pair.
    expect(staggeredCron({ expression: "0 11,15 * * *" }, at("0 11,15 * * *", "10 15 * * *"))).toBe(
      "20 11,15 * * *",
    );
    const hour = at(...[0, 10, 20, 30, 40, 50].map((m) => `${m} 11,15 * * *`));
    expect(staggeredCron({ expression: "0 11,15 * * *" }, hour)).toBe("0 12,16 * * *");
  });

  it("skips an offset at which only some listed minutes would carry into the hour", () => {
    const taken = at("0,30 9 * * *", "10,40 9 * * *", "20,50 9 * * *");
    // +30, +40 and +50 would split the pair over two hours; +60 moves both.
    expect(staggeredCron({ expression: "0,30 9 * * *" }, taken)).toBe("0,30 10 * * *");
  });

  it("leaves a schedule it can't move as the template has it", () => {
    for (const expression of [
      "*/15 3 * * 1",
      "0 9-17 * * 1-5",
      "0 * * * *",
      "0 0 3 * * 1",
      "@daily",
      "0 3,x * * 1",
      "0 24 * * 1",
    ]) {
      expect(staggeredCron({ expression }, at(expression, "0 3 * * 1"))).toBe(expression);
    }
  });

  it("gives a copy with a schedule it can't read no slot", () => {
    expect(staggeredCron({ expression: "0 3 * * 1" }, at("*/10 3 * * 1", "@daily"))).toBe(
      "0 3 * * 1",
    );
  });

  it("compares schedules within the same timezone only", () => {
    const taken: CronSchedule[] = [
      { expression: "0 3 * * 1", timezone: "America/New_York" },
      { expression: "10 3 * * 1", timezone: "Europe/Berlin" },
    ];
    expect(staggeredCron({ expression: "0 3 * * 1", timezone: "America/New_York" }, taken)).toBe(
      "10 3 * * 1",
    );
    expect(staggeredCron({ expression: "0 3 * * 1", timezone: "UTC" }, taken)).toBe("0 3 * * 1");
  });

  it("never passes midnight: the last slot of the day, then the least-used one", () => {
    expect(staggeredCron({ expression: "30 23 * * 1" }, at("30 23 * * 1", "40 23 * * 1"))).toBe(
      "50 23 * * 1",
    );
    const full = at("30 23 * * 1", "40 23 * * 1", "50 23 * * 1");
    expect(staggeredCron({ expression: "30 23 * * 1" }, full)).toBe("30 23 * * 1");
    expect(staggeredCron({ expression: "30 23 * * 1" }, [...full, ...at("30 23 * * 1")])).toBe(
      "40 23 * * 1",
    );
    expect(
      staggeredCron({ expression: "30 23 * * 1" }, [...full, ...at("30 23 * * 1", "40 23 * * 3")]),
    ).toBe("50 23 * * 1");
  });
});

describe("a new project's starter set gets staggered schedules", () => {
  let dir: string;
  let db: Database;
  let store: EventStore;
  let projects: ProjectService;
  let automations: AutomationService;

  const project = (id: string): Project => {
    const stamp = "2026-01-01T00:00:00.000Z";
    return {
      id,
      kind: "github",
      github: {
        owner: "o",
        repo: id,
        remoteUrl: `https://github.com/o/${id}`,
        defaultBranch: "main",
      },
      name: id,
      slug: id,
      path: join(dir, id),
      defaultBranch: "main",
      defaultProvider: null,
      autonomy: null,
      autonomyMode: "assisted",
      visionPath: ".codeden/VISION.md",
      factoryLimits: FactoryLimits.parse({}),
      killSwitch: false,
      timezone: "UTC",
      createdAt: stamp,
      updatedAt: stamp,
      archivedAt: null,
    } as Project;
  };

  /** A project is created; the service's `project.created` handler does exactly this call. */
  const add = (id: string): Automation[] => {
    store.append([{ type: "project.created", sessionId: null, payload: { project: project(id) } }]);
    return automations.definitions.starterSet(id, false);
  };

  const schedule = (projectId: string, templateId: string): string | undefined => {
    const trigger = automations.definitions.find(starterId(projectId, templateId))?.trigger;
    return trigger?.type === "cron" ? trigger.expression : undefined;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "codeden-starter-stagger-"));
    db = openDatabase(join(dir, "codeden.db"));
    store = new EventStore(db.db);
    projects = new ProjectService({
      db: db.db,
      store,
      exec: async () => ({
        code: 0,
        stdout: "",
        stderr: "",
        notFound: false,
        timedOut: false,
        path: null,
      }),
      projectsDir: dir,
    });
    automations = new AutomationService({
      db: db.db,
      store,
      settings: new SettingsStore(join(dir, "settings.json")),
      projects,
      sessions: {} as never,
      repo: {} as never,
      inbox: new InboxService(db.db, store, () => async () => {}),
      orchestration: () => ({}) as never,
      github: {} as never,
      home: join(dir, "home"),
      rescanMs: 0,
    });
    automations.sources.reload();
  });

  afterEach(async () => {
    automations.stop();
    db.close();
    await removeTree(dir);
  });

  it("gives projects created one after another distinct times, and touches nothing else", () => {
    const first = add("p1");
    add("p2");
    add("p3");

    // The first project has the templates' own schedules, days and cadence included.
    expect(schedule("p1", "security-audit")).toBe("0 3 * * 1");
    expect(schedule("p1", "test-coverage")).toBe("0 4 * * 4");
    expect(schedule("p1", "dependency-updates")).toBe("0 5 * * 2");
    expect(schedule("p1", "stale-pr-follow-up")).toBe("0 8 * * 1-5");
    for (const [template, hour, days] of [
      ["security-audit", 3, "1"],
      ["test-coverage", 4, "4"],
      ["dependency-updates", 5, "2"],
      ["stale-pr-follow-up", 8, "1-5"],
    ] as const) {
      expect(schedule("p2", template)).toBe(`10 ${hour} * * ${days}`);
      expect(schedule("p3", template)).toBe(`20 ${hour} * * ${days}`);
    }

    // As before: every starter is created off, and the event-triggered one is the template's.
    const all = () => automations.definitions.all().filter((a) => a.id.startsWith("starter:"));
    expect(first.map((a) => a.templateId).sort()).toEqual([
      "dependency-updates",
      "issue-triage",
      "security-audit",
      "stale-pr-follow-up",
      "test-coverage",
    ]);
    expect(all().every((a) => !a.enabled && a.approvedAutonomy === undefined)).toBe(true);
    for (const p of ["p1", "p2", "p3"]) {
      expect(automations.definitions.get(starterId(p, "issue-triage")).trigger).toEqual({
        type: "event",
        event: "issue.opened",
      });
    }

    // A person moves one copy; one project is archived. Its slots are free again, the moved
    // copy's old slot too, and no existing automation is rescheduled by what follows.
    const security = automations.definitions.get(starterId("p2", "security-audit"));
    if (security.trigger.type !== "cron") throw new Error("expected a schedule");
    automations.definitions.update(security.id, {
      trigger: { ...security.trigger, expression: "30 6 * * 1" },
    });
    projects.archive("p1");
    const before = JSON.stringify(all());

    add("p4");
    add("p5");
    expect(schedule("p4", "security-audit")).toBe("0 3 * * 1");
    expect(schedule("p5", "security-audit")).toBe("10 3 * * 1");
    expect(schedule("p4", "dependency-updates")).toBe("0 5 * * 2");
    expect(schedule("p5", "dependency-updates")).toBe("30 5 * * 2");
    expect(JSON.stringify(all().filter((a) => !/^starter:p[45]:/.test(a.id)))).toBe(before);

    // Asking for the starter set again keeps what a project has.
    automations.definitions.starterSet("p5", false);
    expect(schedule("p5", "security-audit")).toBe("10 3 * * 1");
  });
});
