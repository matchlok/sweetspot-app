import { addDays, denverToday, mondayOf } from "@sweetspot/engine";
import type { DataDeps } from "./data";
import type { PlannedSession } from "./repo";

/** Key under extendedProperties.private that marks an event the app wrote. A rebuild touches only these. */
export const PROGRAM_TAG = "sweetspotProgram";
export const KIND_TAG = "sweetspotKind";

/** Monday to Sunday of the week two ahead of `now`, in America/Denver. Run on Sunday night, it is the week after next. */
export function targetWeek(now: Date): { oldest: string; newest: string } {
  const oldest = addDays(mondayOf(denverToday(now)), 14);
  return { oldest, newest: addDays(oldest, 6) };
}

export interface WriteWeekResult {
  oldest: string;
  newest: string;
  deleted: number;
  created: number;
}

/**
 * Rebuild one week of the calendar from planned sessions: delete the events the
 * app wrote there (tagged `sweetspotProgram`), then create one single event per
 * session. Untagged events are never touched. `sessions` is injected so the
 * source can be Neon or a test list.
 */
export async function writeWeek(
  d: Pick<DataDeps, "repo" | "sources">,
  week: { oldest: string; newest: string },
  sessions: PlannedSession[],
): Promise<WriteWeekResult> {
  const { createEvent, deleteEvent } = d.sources;
  if (!createEvent || !deleteEvent) throw new Error("Calendar writer is not configured");

  const existing = await d.sources.events(week.oldest, week.newest);
  const ours = existing.filter((e) => e.extendedProperties?.private?.[PROGRAM_TAG] !== undefined && e.status !== "cancelled");
  for (const e of ours) await deleteEvent(e.id);

  let created = 0;
  for (const s of sessions) {
    if (s.status !== "planned" || s.date < week.oldest || s.date > week.newest) continue;
    const id = await createEvent({
      date: s.date,
      summary: s.title ?? s.kind,
      description: `${s.minutes} min`,
      tags: { [KIND_TAG]: s.kind, [PROGRAM_TAG]: String(s.programId) },
    });
    await d.repo.updatePlannedSession(s.id, { calendarEventId: id });
    created++;
  }
  return { ...week, deleted: ours.length, created };
}

/** The Sunday cron: write the week two ahead from the repo's planned sessions. */
export async function writeWeekTwoAhead(d: DataDeps): Promise<WriteWeekResult> {
  const week = targetWeek((d.now ?? (() => new Date()))());
  return writeWeek(d, week, await d.repo.plannedSessions(week.oldest, week.newest));
}
