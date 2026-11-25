import type {
  Automation,
  AutomationTemplate,
  AutomationTrigger,
  Project,
} from "@codeden/contracts";
import { effectiveTimezone } from "../automations/cron";

/**
 * Staggered start times for a new project's scheduled starter automations.
 *
 * Every project used to get the template's own schedule, so the same automation started at the
 * same moment in all of them. A new project's copy now starts 0, 10, 20, ... minutes after the
 * template's time: the lowest offset whose time no active project's copy of that starter uses.
 *
 * The rules, all in `staggeredCron`:
 * - Only the minute and hour fields change; days, months and cadence stay the template's.
 * - Two schedules are at the same moment when they share a minute and hour in the same
 *   timezone. Schedules in different timezones are not compared (no conversion to instants).
 * - A schedule is moved only when its minute and hour fields are plain numbers or plain lists
 *   of numbers (`0 5 * * 2`, `0 11,15 * * *`). Ranges, steps, `*`, nicknames and expressions
 *   that don't have five fields are left as the template has them, and a copy of that kind
 *   occupies no slot.
 * - An offset never carries a time past midnight, which would change the day it runs on. When
 *   every slot of the day is taken, the least-used one is chosen (earliest first).
 */

/** Minutes between two projects' start times of the same starter automation. */
export const STAGGER_STEP_MINUTES = 10;

const MINUTES_PER_DAY = 24 * 60;

/** A cron schedule and the timezone it runs in. */
export interface CronSchedule {
  expression: string;
  /** The timezone it runs in; schedules are only compared within the same one. */
  timezone?: string;
}

interface DailyTimes {
  minutes: number[];
  hours: number[];
  /** The fields after minute and hour, as written. */
  rest: string[];
}

/** A plain number or a plain comma list of numbers up to `max`; null for anything else. */
function plainList(field: string, max: number): number[] | null {
  if (!/^\d{1,2}(,\d{1,2})*$/.test(field)) return null;
  const values = field.split(",").map(Number);
  return values.every((v) => v <= max) ? values : null;
}

/** The times of day a five-field expression with plain minute and hour fields fires at. */
function dailyTimes(expression: string): DailyTimes | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute = "", hour = "", ...rest] = fields;
  const minutes = plainList(minute, 59);
  const hours = plainList(hour, 23);
  return minutes && hours ? { minutes, hours, rest } : null;
}

/** Minutes since midnight of every time the schedule fires at. */
function minutesOfDay(times: DailyTimes): number[] {
  return times.hours.flatMap((h) => times.minutes.map((m) => h * 60 + m));
}

/**
 * `times` moved `offset` minutes later, or null when that can't be written as one expression:
 * a time would pass midnight, or only some of the listed minutes would carry into the hour.
 */
function shifted(times: DailyTimes, offset: number): DailyTimes | null {
  if (Math.max(...minutesOfDay(times)) + offset >= MINUTES_PER_DAY) return null;
  const carries = new Set(times.minutes.map((m) => Math.floor((m + offset) / 60)));
  if (carries.size !== 1) return null;
  const [carry = 0] = carries;
  return {
    minutes: times.minutes.map((m) => (m + offset) % 60),
    hours: times.hours.map((h) => h + carry),
    rest: times.rest,
  };
}

/**
 * The cron expression for a new project's copy of a scheduled starter: the template's, moved
 * to the next free 10-minute slot. `taken` are the schedules the active projects' copies of
 * that starter have now. The template's expression comes back unchanged for the first project
 * and for a shape that is not moved (see the top of this file).
 */
export function staggeredCron(template: CronSchedule, taken: CronSchedule[]): string {
  const base = dailyTimes(template.expression);
  if (!base) return template.expression;
  // What each copy in the same timezone occupies, as minutes since midnight.
  const occupied = taken
    .filter((t) => t.timezone === template.timezone)
    .map((t) => dailyTimes(t.expression))
    .filter((t) => t !== null)
    .map((t) => new Set(minutesOfDay(t)));

  let best: { offset: number; times: DailyTimes; users: number } | undefined;
  for (let offset = 0; offset < MINUTES_PER_DAY; offset += STAGGER_STEP_MINUTES) {
    const times = shifted(base, offset);
    if (!times) continue;
    const mine = minutesOfDay(times);
    const users = occupied.filter((theirs) => mine.some((m) => theirs.has(m))).length;
    if (!best || users < best.users) best = { offset, times, users };
    if (users === 0) break;
  }
  if (!best || best.offset === 0) return template.expression;
  return [best.times.minutes.join(","), best.times.hours.join(","), ...best.times.rest].join(" ");
}

/**
 * The trigger a project's new copy of a starter template is created with: the template's own,
 * with a scheduled one moved to the next free slot among the active projects' copies. An event
 * or manual trigger is returned as it is. A project's copy is read through `copyOf`; one that
 * was deleted or is no longer scheduled occupies no slot, and neither does the project itself
 * or an archived project (`activeProjects` has none).
 */
export function staggeredStarterTrigger(
  template: Pick<AutomationTemplate, "trigger">,
  project: Project,
  activeProjects: Project[],
  copyOf: (projectId: string) => Automation | undefined,
): AutomationTrigger {
  const trigger = template.trigger;
  if (trigger.type !== "cron") return trigger;
  const taken: CronSchedule[] = [];
  for (const other of activeProjects) {
    if (other.id === project.id || other.archivedAt !== null) continue;
    const theirs = copyOf(other.id)?.trigger;
    if (theirs?.type !== "cron") continue;
    taken.push({
      expression: theirs.expression,
      timezone: effectiveTimezone(other, theirs.timezone),
    });
  }
  const expression = staggeredCron(
    { expression: trigger.expression, timezone: effectiveTimezone(project, trigger.timezone) },
    taken,
  );
  return expression === trigger.expression ? trigger : { ...trigger, expression };
}
