import { TZ, addDays } from "./dates";

/**
 * Calendar reader. Pure: takes Google Calendar event instances (fetch with
 * `singleEvents: true` and `showDeleted: true` so recurring series arrive
 * expanded and skipped instances arrive as `cancelled`) and returns the
 * week's planned sessions. The API layer does the fetching.
 */

export type SessionKind =
  | "endurance"
  | "sweet_spot"
  | "threshold"
  | "vo2"
  | "easy_spin"
  | "lift_upper"
  | "lift_lower";

export const SESSION_KINDS: readonly SessionKind[] = [
  "endurance",
  "sweet_spot",
  "threshold",
  "vo2",
  "easy_spin",
  "lift_upper",
  "lift_lower",
];

/** The subset of a Google Calendar event the reader uses. */
export interface CalendarEvent {
  /** Instance id (not the series id). */
  id: string;
  summary?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  /** All-day events carry `date`; timed events carry `dateTime` with an offset. */
  start: { date?: string; dateTime?: string };
  /** Where a recurring instance sat before it was moved. Google keeps this on moved instances. */
  originalStartTime?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export interface PlannedSession {
  id: string;
  /** "YYYY-MM-DD", America/Denver. */
  date: string;
  kind: SessionKind;
  title: string;
  minutes: number | null;
  /** A cancelled instance is a skip. */
  status: "planned" | "skipped";
  kindSource: "tag" | "title";
  /** Set on a session that moved in from another week: the date it was planned for. */
  movedFrom?: string;
  /**
   * Set on the stand-in for a session that moved out of this week, dated on its
   * original day and `skipped`: the origin week records a miss for it.
   */
  movedTo?: string;
}

export interface WeekPlan {
  /** Monday, "YYYY-MM-DD". */
  weekStart: string;
  sessions: PlannedSession[];
  /** Events in the week whose kind couldn't be read. Never guessed. */
  unrecognized: { id: string; date: string; title: string }[];
}

const isKind = (s: string | undefined): s is SessionKind => !!s && (SESSION_KINDS as readonly string[]).includes(s);

/**
 * Kind from a title, for events that aren't tagged yet. Covers the Muse-era
 * titles ("VO2 Max Intervals — Trail (~1 hr)", "Lift A — Lower Body + Core").
 * Returns null when nothing matches.
 */
export function kindFromTitle(title: string): SessionKind | null {
  const t = title.toLowerCase();
  if (/\blift\b/.test(t) || /\b(upper|lower) body\b/.test(t)) {
    if (/\blower\b/.test(t) || /\blift a\b/.test(t)) return "lift_lower";
    if (/\bupper\b/.test(t) || /\blift b\b/.test(t)) return "lift_upper";
    return null;
  }
  if (/\beasy spin\b/.test(t)) return "easy_spin";
  if (/\bvo2\b/.test(t)) return "vo2";
  if (/\bsweet ?spot\b/.test(t)) return "sweet_spot";
  if (/\bthreshold\b/.test(t)) return "threshold";
  if (/\bendurance\b/.test(t)) return "endurance";
  return null;
}

/** Minutes from the last parenthetical: "(30 min)", "(~50 min)", "(1.5 hrs)", "(~1 hr)". Null if absent. */
export function minutesFromTitle(title: string): number | null {
  const groups = [...title.matchAll(/\(([^)]*)\)/g)];
  for (let i = groups.length - 1; i >= 0; i--) {
    const m = /(\d+(?:\.\d+)?)\s*(min|mins|minutes|hr|hrs|hour|hours)\b/i.exec(groups[i]![1]!);
    if (m) {
      const n = Number(m[1]);
      return /^m/i.test(m[2]!) ? Math.round(n) : Math.round(n * 60);
    }
  }
  return null;
}

const denverDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** All-day dates are used as written. Timed events are placed by their Denver date. */
export function eventDate(e: CalendarEvent): string | null {
  if (e.start.date) return e.start.date;
  if (e.start.dateTime) return denverDate.format(new Date(e.start.dateTime));
  return null;
}

/** A stand-in left on a session's original day after it moved out of the week. It is a record, not a session to act on. */
export const isOriginStandIn = (id: string): boolean => id.endsWith("~origin");

/**
 * Sessions in the Mon-Sun week starting `weekStart`, sorted by date then title.
 * Pass events from the neighbouring weeks too, so moves across weeks resolve:
 *
 * - A session moved out of this week (its original day is here, its new day is
 *   not) stays on its original day as a skipped stand-in with `movedTo`. The
 *   week records a miss for it (rule 4, 2026-11-20).
 * - A session moved in from another week replaces this week's own session of
 *   the same kind, so the week never carries two (no 3/2 counts). The replaced
 *   one is dropped, whether the calendar still shows it or has cancelled it.
 */
export function readWeek(events: readonly CalendarEvent[], weekStart: string): WeekPlan {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = (d: string) => d >= weekStart && d <= weekEnd;
  let sessions: PlannedSession[] = [];
  const unrecognized: WeekPlan["unrecognized"] = [];

  for (const e of events) {
    const date = eventDate(e);
    if (!date) continue;
    const origin = e.originalStartTime ? (eventDate({ id: e.id, start: e.originalStartTime }) ?? date) : date;
    const here = inWeek(date);
    const originHere = inWeek(origin);
    if (!here && !originHere) continue;
    const title = e.summary ?? "";
    const tag = e.extendedProperties?.private?.sweetspotKind;
    const kind = isKind(tag) ? tag : kindFromTitle(title);
    if (!kind) {
      if (here) unrecognized.push({ id: e.id, date, title });
      continue;
    }
    const cancelled = e.status === "cancelled";
    const base = { kind, title, minutes: minutesFromTitle(title), kindSource: (isKind(tag) ? "tag" : "title") as "tag" | "title" };
    if (here) {
      const s: PlannedSession = { id: e.id, date, ...base, status: cancelled ? "skipped" : "planned" };
      if (origin !== date && !originHere) s.movedFrom = origin;
      sessions.push(s);
    } else {
      // Original day is in this week, current day is elsewhere.
      const g: PlannedSession = { id: `${e.id}~origin`, date: origin, ...base, status: "skipped" };
      if (!cancelled) g.movedTo = date;
      sessions.push(g);
    }
  }

  const movedIn = sessions.filter((s) => s.movedFrom && s.status === "planned");
  if (movedIn.length > 0) {
    const kinds = new Set(movedIn.map((s) => s.kind));
    sessions = sessions.filter((s) => !(kinds.has(s.kind) && !s.movedFrom && !s.movedTo));
  }

  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return { weekStart, sessions, unrecognized };
}
