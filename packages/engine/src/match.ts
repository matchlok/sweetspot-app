import type { PlannedSession, SessionKind } from "./calendar";
import type { Category } from "./categorize";
import type { RideZones } from "./intervals";

/**
 * Ride matching by what was done, not by the planned date alone. Ported from
 * `_ride_match()` in reference/muse/strava_tracker.py (rules unchanged).
 *
 * Callers pass the sessions `readWeek` produced, so skipped sessions and the
 * stand-ins for sessions that moved out of the week are never matched (they stay
 * misses), and a session moved in from another week matches on its new date.
 */

/** A ride with no zone data counts toward endurance or easy plans from this long. Muse: UNKNOWN_RIDE_FALLBACK_MIN. */
export const UNKNOWN_RIDE_FALLBACK_MIN = 30;

const QUALITY_KINDS: ReadonlySet<SessionKind> = new Set(["vo2", "sweet_spot"]);

export interface RideMatch {
  /** The ride that satisfies the plan, or null when none does (a miss). */
  ride: RideZones | null;
  /** What the ride turned out to be, when there was one. Set on a miss too, so reports can say what happened. */
  detected: Category | null;
  /** True when a quality ride of the other category, or a different category from the plan, satisfied it. */
  substituted: boolean;
}

const MISS: RideMatch = { ride: null, detected: null, substituted: false };

/** Longest ride first, like the Muse query. */
const byLongest = (a: RideZones, b: RideZones) => b.movingSeconds - a.movingSeconds;

/**
 * Picks the ride that satisfies a planned ride session from the rides on its day.
 *
 * - An exact category match wins.
 * - A quality plan (VO2 or sweet spot) is satisfied by either quality category;
 *   the swap shows in `detected` and `substituted`.
 * - An endurance plan accepts any categorized ride.
 * - An easy spin accepts any ride.
 * - A quality plan with only an endurance ride is a miss.
 * - A ride with unknown zones satisfies endurance or easy plans from 30 minutes,
 *   so a data gap never makes a miss.
 */
export function rideMatch(plannedKind: SessionKind, rides: readonly RideZones[]): RideMatch {
  if (rides.length === 0) return MISS;
  const sorted = [...rides].sort(byLongest);
  const first = (cat: Category) => sorted.find((r) => r.category === cat);
  const hit = (ride: RideZones): RideMatch => ({ ride, detected: ride.category, substituted: ride.category !== plannedKind });

  const exact = first(plannedKind as Category);
  if (exact) return hit(exact);

  if (QUALITY_KINDS.has(plannedKind)) {
    for (const cat of ["vo2", "sweet_spot"] as const) {
      const r = first(cat);
      if (r) return hit(r);
    }
    return { ride: null, detected: first("endurance") ? "endurance" : sorted[0]!.category, substituted: false };
  }

  if (plannedKind === "endurance") {
    for (const cat of ["endurance", "sweet_spot", "vo2"] as const) {
      const r = first(cat);
      if (r) return hit(r);
    }
    const unknown = sorted.filter((r) => r.category === "unknown");
    const long = unknown.find((r) => r.movingSeconds >= UNKNOWN_RIDE_FALLBACK_MIN * 60);
    if (long) return hit(long);
    return { ride: null, detected: unknown.length > 0 ? "unknown" : null, substituted: false };
  }

  if (plannedKind === "easy_spin") {
    const r = sorted[0]!;
    return { ride: r, detected: r.category, substituted: false };
  }

  return MISS;
}

/** Plan kinds Muse had no matching rule for (threshold). They keep the old rule: any ride that day counts. */
const isLift = (k: SessionKind) => k === "lift_upper" || k === "lift_lower";
const hasRule = (k: SessionKind) => QUALITY_KINDS.has(k) || k === "endurance" || k === "easy_spin";

/**
 * Matches each live ride session in `sessions` to a ride on its date. Skipped
 * sessions and lifts are left out. A ride satisfies one session only. Kinds with
 * no Muse rule (threshold) accept any ride that day.
 */
export function matchRides(sessions: readonly PlannedSession[], rides: readonly RideZones[]): Map<string, RideMatch> {
  const out = new Map<string, RideMatch>();
  const taken = new Set<string>();
  for (const s of sessions) {
    if (s.status === "skipped" || isLift(s.kind)) continue;
    const free = rides.filter((r) => r.date === s.date && !taken.has(r.id));
    const m = hasRule(s.kind)
      ? rideMatch(s.kind, free)
      : free.length > 0
        ? (() => {
            const r = [...free].sort(byLongest)[0]!;
            return { ride: r, detected: r.category, substituted: false };
          })()
        : MISS;
    if (m.ride) taken.add(m.ride.id);
    out.set(s.id, m);
  }
  return out;
}
