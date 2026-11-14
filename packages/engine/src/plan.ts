import type { GoalKey } from "./targets";
import { denverToday } from "./dates";
import type { PlannedSession, SessionKind } from "./calendar";
import type { IntervalsActivity } from "./intervals";

/** Goal a ride session serves. Easy spins and lifts serve no minutes goal. */
export function goalServedBy(kind: SessionKind): GoalKey | null {
  switch (kind) {
    case "endurance": return "endurance";
    case "sweet_spot": return "sweetSpot";
    case "threshold": return "threshold";
    case "vo2": return "vo2";
    default: return null;
  }
}

/** Goals the week's plan has a live (not skipped) session for. Feeds `programState`'s `planned` option. */
export function plannedGoals(sessions: readonly PlannedSession[]): Set<GoalKey> {
  const out = new Set<GoalKey>();
  for (const s of sessions) {
    const g = s.status === "skipped" ? null : goalServedBy(s.kind);
    if (g) out.add(g);
  }
  return out;
}

// ---- Strength ----

export type LiftKey = "upper" | "lower";
export const LIFT_KEYS: readonly LiftKey[] = ["upper", "lower"];
export const MAX_LIFT_TARGET = 7;

export interface LiftActivity {
  id: string;
  date: string;
  movingSeconds: number;
}

/** WeightTraining activities as local dates. Stub rows and bad dates are dropped. */
export function mapLifts(raw: readonly IntervalsActivity[]): LiftActivity[] {
  const out: LiftActivity[] = [];
  for (const a of raw) {
    if (a.type !== "WeightTraining" || a._note) continue;
    const date = a.start_date_local?.slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({ id: String(a.id ?? `${date}-${a.moving_time ?? 0}`), date, movingSeconds: a.moving_time ?? 0 });
  }
  return out;
}

export interface LiftMatch {
  /** Lift activity id -> the planned lift session it counts for. */
  matched: Map<string, { sessionId: string; lift: LiftKey }>;
  /** Lifts with no planned lift that day. Their type is unknown, so they count for neither. */
  unassigned: LiftActivity[];
}

/**
 * Matches each logged lift to a planned lift on the same date. With two lifts
 * and two planned lifts that day, they pair in order. Never guesses a type.
 */
export function matchLifts(planned: readonly PlannedSession[], lifts: readonly LiftActivity[]): LiftMatch {
  const matched: LiftMatch["matched"] = new Map();
  const unassigned: LiftActivity[] = [];
  const free = planned.filter((s) => s.status !== "skipped" && (s.kind === "lift_upper" || s.kind === "lift_lower"));
  const taken = new Set<string>();
  for (const l of [...lifts].sort((a, b) => a.id.localeCompare(b.id))) {
    const s = free.find((p) => p.date === l.date && !taken.has(p.id));
    if (!s) {
      unassigned.push(l);
      continue;
    }
    taken.add(s.id);
    matched.set(l.id, { sessionId: s.id, lift: s.kind === "lift_upper" ? "upper" : "lower" });
  }
  return { matched, unassigned };
}

export interface LiftCount {
  actual: number;
  target: number;
  hit: boolean;
}

/** Sessions done per lift type against a 0-7 target. Done or missed, no weights or reps. */
export function liftCounts(match: LiftMatch, targets: Record<LiftKey, number>): Record<LiftKey, LiftCount> {
  const out = {} as Record<LiftKey, LiftCount>;
  for (const k of LIFT_KEYS) {
    const target = Math.min(MAX_LIFT_TARGET, Math.max(0, Math.round(targets[k])));
    const actual = [...match.matched.values()].filter((m) => m.lift === k).length;
    out[k] = { actual, target, hit: actual >= target };
  }
  return out;
}

// ---- Not logged ----

export interface LoggedDays {
  rideDates: ReadonlySet<string>;
  liftDates: ReadonlySet<string>;
}

/** Muse used a 21:00 local guard: today isn't "not logged" until then. */
export const NOT_LOGGED_HOUR = 21;

function denverHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(h);
}

export type ResolvedStatus = "planned" | "done" | "not_logged" | "skipped";

/**
 * Status for a planned session. Done when an activity of the right sport is
 * logged that date. A past day with nothing logged is `not_logged`; today
 * becomes `not_logged` only from 21:00 Denver. Whether a ride hit its zones is
 * the goal system's call, not this one.
 */
export function sessionStatus(s: PlannedSession, logged: LoggedDays, now: Date = new Date()): ResolvedStatus {
  if (s.status === "skipped") return "skipped";
  const isLift = s.kind === "lift_upper" || s.kind === "lift_lower";
  if ((isLift ? logged.liftDates : logged.rideDates).has(s.date)) return "done";
  const today = denverToday(now);
  if (s.date < today) return "not_logged";
  if (s.date === today && denverHour(now) >= NOT_LOGGED_HOUR) return "not_logged";
  return "planned";
}
