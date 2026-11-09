/**
 * Light intensity classifier from time-in-zone. Ported from
 * reference/muse/strava_tracker.py `categorize()`; thresholds are unchanged.
 *
 * power: 7 zones. Sweet spot (~88-94% FTP) straddles upper Z3 and Z4.
 * heartrate: zones are the athlete's, as stored. HR lags on short intervals,
 * so VO2 is a few minutes in Z5, or a small Z5 dose on top of a big Z4+Z5 total.
 * intervals.icu returns 7 values. VO2 is Z5 only for both sources: Z6 and Z7 are
 * anaerobic and neuromuscular (Coggan), not aerobic VO2 work.
 */
export type ZoneSource = "power" | "heartrate";
export type Category = "vo2" | "sweet_spot" | "endurance" | "unknown";

/** Seconds per zone, Z1 first. */
export type ZoneSeconds = readonly number[];

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function categorize(source: ZoneSource, zoneSeconds: ZoneSeconds): Category {
  const total = sum(zoneSeconds);
  if (total <= 0) return "unknown"; // missing zones are unknown, never a guess
  const m = zoneSeconds.map((s) => s / 60);
  const at = (i: number) => m[i] ?? 0;

  if (source === "power") {
    // Z5 only. Z6 (anaerobic) and Z7 (neuromuscular) are not aerobic VO2 work.
    const vo2Min = at(4);
    const ssMin = at(3) + 0.5 * at(2); // Z4 + half of Z3
    if (vo2Min >= 5) return "vo2";
    if (ssMin >= 10) return "sweet_spot";
    return "endurance";
  }

  const vo2Min = at(4); // Z5
  const ssMin = at(3); // Z4
  const totalMin = total / 60;
  const vo2Share = vo2Min / totalMin;
  if (vo2Min >= 3 && vo2Share >= 0.04) return "vo2";
  // HR-lag path for interval sessions; long rides need the share test above,
  // or every hilly endurance ride would read as VO2.
  if (totalMin <= 100 && vo2Min >= 1.5 && vo2Min + ssMin >= 14) return "vo2";
  if (ssMin >= 8) return "sweet_spot";
  return "endurance";
}

/**
 * Prefer power, fall back to heart rate; first non-unknown wins.
 * Mirrors store_zones() in the Muse script.
 */
export function categorizeActivity(zones: {
  power?: ZoneSeconds;
  heartrate?: ZoneSeconds;
}): { category: Category; source: ZoneSource | null } {
  for (const source of ["power", "heartrate"] as const) {
    const z = zones[source];
    if (!z) continue;
    const category = categorize(source, pad7(z));
    if (category !== "unknown") return { category, source };
  }
  return { category: "unknown", source: null };
}

/** intervals.icu `icu_hr_zone_times` etc: 7 values, padded/truncated to 7. */
export function pad7(z: ZoneSeconds): number[] {
  return [...z, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);
}
