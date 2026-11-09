import { addDays, mondayOf } from "./dates";

/**
 * Weekly zone target bands (minutes of time-in-zone), from the Muse
 * script (Oct 17, 2026). They were tuned on HR; power weeks reuse them unchanged. Easy = Z1+Z2, quality = Z4+Z5, Z3 is watched for
 * tempo drift.
 */
export const ZONE_BANDS = {
  normal: { easyMin: 60, qualityMin: 12, qualityMax: 30 },
  recovery: { easyMin: 35, qualityMin: 0, qualityMax: 30 },
} as const;

export type WeekKind = keyof typeof ZONE_BANDS;

/**
 * Zone seconds per zone summed over one Mon-Sun week. Z5 includes Z6+Z7.
 * Each ride contributes its power zones when it has sensor power, otherwise
 * its HR zones, so a week can mix the two. `powerRides` of `rides` used power.
 */
export interface WeekZones {
  /** Monday, America/Denver, "YYYY-MM-DD". */
  start: string;
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
  /** Rides counted (those with power or HR zones). */
  rides: number;
  /** Subset of `rides` scored from power; the rest are HR. */
  powerRides: number;
  /** Seconds at 88-94% FTP from power rides. Overlaps z3/z4, so don't add it to them. */
  ssSeconds: number;
  /**
   * Goal minutes, kept apart so they don't inflate each other:
   * endurance = Z2+Z3 (no Z1), vo2 = Z5 only (no Z4, no Z6/Z7). Each ride's
   * zones come from its own source (power, else HR). Sweet spot is `ssSeconds`
   * and exists for power rides only.
   */
  enduranceSeconds: number;
  vo2Seconds: number;
}

export interface ActivityZones {
  /** Local start date, "YYYY-MM-DD" (America/Denver). */
  date: string;
  /** 7 HR zone seconds, or undefined if the ride has none. */
  heartrate?: readonly number[];
  /** 7 power zone seconds from a sensor, or undefined. Preferred over HR. */
  power?: readonly number[];
  /**
   * Seconds at 88-94% FTP (intervals.icu "SS"). A separate range that overlaps
   * power Z3/Z4; reported alongside the zones, never subtracted from them.
   */
  sweetSpotSeconds?: number;
}

export function emptyWeek(start: string): WeekZones {
  return { start, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, rides: 0, powerRides: 0, ssSeconds: 0, enduranceSeconds: 0, vo2Seconds: 0 };
}

/**
 * Weekly totals, most recent first. Power zones win over HR per ride; rides
 * with neither are not counted.
 */
export function weeklyZoneRows(
  activities: readonly ActivityZones[],
  today: string,
  weeksBack = 4,
): WeekZones[] {
  const monday = mondayOf(today);
  const rows: WeekZones[] = [];
  for (let w = 0; w < weeksBack; w++) {
    const start = addDays(monday, -7 * w);
    const end = addDays(start, 7);
    const row = emptyWeek(start);
    for (const a of activities) {
      if (a.date < start || a.date >= end) continue;
      const z = a.power ?? a.heartrate;
      if (!z) continue;
      if (a.power) {
        row.powerRides += 1;
        row.ssSeconds += a.sweetSpotSeconds ?? 0;
      }
      row.enduranceSeconds += (z[1] ?? 0) + (z[2] ?? 0);
      row.vo2Seconds += z[4] ?? 0;
      row.z1 += z[0] ?? 0;
      row.z2 += z[1] ?? 0;
      row.z3 += z[2] ?? 0;
      row.z4 += z[3] ?? 0;
      row.z5 += (z[4] ?? 0) + (z[5] ?? 0) + (z[6] ?? 0);
      row.rides += 1;
    }
    rows.push(row);
  }
  return rows;
}

export type BandStatus = "ok" | "below" | "high";

export interface WeekScore {
  start: string;
  kind: WeekKind;
  inProgress: boolean;
  rides: number;
  /** Rides scored from power; the rest are HR and have no sweet-spot figure. */
  powerRides: number;
  easyMin: number;
  easyStatus: BandStatus;
  qualityMin: number;
  /** null for recovery weeks, which have no quality target. */
  qualityStatus: BandStatus | null;
  z3Min: number;
  /** Minutes at 88-94% FTP, power rides only. Informational; not part of any band. */
  ssMin: number;
  /** Goal minutes (see WeekZones). No targets yet: they come from the plan once it's connected. */
  enduranceMin: number;
  vo2Min: number;
  tempoDrift: boolean;
}

/**
 * Score each planned week against the bands. `planKinds` maps a week's Monday
 * to the set of planned session kinds; weeks without a plan are skipped
 * (actuals only, no scorecard). A week with an "easy_spin" is a recovery week.
 */
export function zoneScorecard(
  weeks: readonly WeekZones[],
  planKinds: ReadonlyMap<string, ReadonlySet<string>>,
  today: string,
): WeekScore[] {
  const out: WeekScore[] = [];
  for (const w of weeks) {
    const kinds = planKinds.get(w.start);
    if (!kinds || kinds.size === 0) continue;
    const kind: WeekKind = kinds.has("easy_spin") ? "recovery" : "normal";
    const band = ZONE_BANDS[kind];
    const inProgress = w.start <= today && today < addDays(w.start, 7);
    const easyMin = (w.z1 + w.z2) / 60;
    const qualityMin = (w.z4 + w.z5) / 60;
    const z3Min = w.z3 / 60;
    out.push({
      start: w.start,
      kind,
      inProgress,
      rides: w.rides,
      easyMin,
      easyStatus: easyMin >= band.easyMin ? "ok" : "below",
      qualityMin,
      qualityStatus:
        band.qualityMin === 0
          ? null
          : qualityMin < band.qualityMin
            ? "below"
            : qualityMin > band.qualityMax
              ? "high"
              : "ok",
      z3Min,
      ssMin: w.ssSeconds / 60,
      enduranceMin: w.enduranceSeconds / 60,
      vo2Min: w.vo2Seconds / 60,
      powerRides: w.powerRides,
      tempoDrift: z3Min > easyMin && z3Min >= 20,
    });
  }
  return out;
}
