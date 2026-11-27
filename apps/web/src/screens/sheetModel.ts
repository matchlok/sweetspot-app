import type { DayOption, Session } from "@sweetspot/engine";
import { DONE_DOT, NOT_LOGGED_DOT, SKIPPED_DOT } from "./dots";

/** Denver's today, as YYYY-MM-DD. */
export function denverToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Denver" });
}

/** The first day after the session's week (Monday to Sunday). */
function weekEnd(date: string): string {
  const t = new Date(`${date}T12:00:00Z`);
  const back = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - back + 7);
  return t.toISOString().slice(0, 10);
}

export interface SheetStatus {
  label: "Done" | "Not done" | "Missed";
  color: string;
}

/**
 * The move sheet's status header. Done is green. A planned, not-logged or skipped session is
 * "Not done" (gray) during its week and "Missed" (yellow) once the week is over.
 */
export function sheetStatus(s: Pick<Session, "status" | "date">, today: string): SheetStatus {
  if (s.status === "done") return { label: "Done", color: DONE_DOT };
  if (today >= weekEnd(s.date)) return { label: "Missed", color: NOT_LOGGED_DOT };
  return { label: "Not done", color: SKIPPED_DOT };
}

/** The one summary above the button for a move, swap or skip: the engine's effect lines, in order. */
export function optionSummary(o: Pick<DayOption, "effects">): string {
  return o.effects.map((e) => e.text).join(" ");
}

/** The summary for "Mark done manually". */
export function markDoneSummary(title: string): string {
  return `${title} is marked done by hand and counts for this week.`;
}
