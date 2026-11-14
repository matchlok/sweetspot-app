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

/** Sessions in the Mon-Sun week starting `weekStart`, sorted by date then title. */
export function readWeek(events: readonly CalendarEvent[], weekStart: string): WeekPlan {
  const weekEnd = addDays(weekStart, 6);
  const sessions: PlannedSession[] = [];
  const unrecognized: WeekPlan["unrecognized"] = [];

  for (const e of events) {
    const date = eventDate(e);
    if (!date || date < weekStart || date > weekEnd) continue;
    const title = e.summary ?? "";
    const tag = e.extendedProperties?.private?.sweetspotKind;
    const kind = isKind(tag) ? tag : kindFromTitle(title);
    if (!kind) {
      unrecognized.push({ id: e.id, date, title });
      continue;
    }
    sessions.push({
      id: e.id,
      date,
      kind,
      title,
      minutes: minutesFromTitle(title),
      status: e.status === "cancelled" ? "skipped" : "planned",
      kindSource: isKind(tag) ? "tag" : "title",
    });
  }

  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return { weekStart, sessions, unrecognized };
}
