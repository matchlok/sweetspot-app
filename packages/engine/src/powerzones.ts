/**
 * Zone seconds from a raw power stream, for rides intervals.icu does not hold
 * (Zwift rides arrive from Strava only). Pure: callers pass FTP and the zone
 * definitions read from intervals.icu, so this file holds no settings.
 * No watts means no answer (`undefined`), never a guess.
 *
 * Method fitted 2026-11-21 on the 2026-11-13 MTB ride, which both sources hold
 * (identical raw watts), against intervals.icu's own `icu_zone_times`:
 *   - resample to 1 Hz, drop stopped samples (Strava `moving` stream);
 *   - 5 s trailing mean of watts, rounded to whole watts;
 *   - zone tops are inclusive, in watts: Z1..Z6 top = FTP x pct / 100;
 *   - sweet spot is inclusive whole watts from floor(FTP x min%) to floor(FTP x max%),
 *     using intervals.icu's `sweet_spot_min`/`sweet_spot_max` (live: 84 and 97, not 88 to 94).
 * Result on that ride: every zone within 6 s of intervals.icu, sweet spot within 1 s.
 */

export interface PowerSettings {
  /** FTP in watts, from intervals.icu. */
  ftp: number;
  /** Zone tops as percent of FTP for Z1..Z6 (a Z7 entry is ignored). intervals.icu: [55, 75, 90, 105, 120, 150, 999]. */
  zoneTopsPct: readonly number[];
  /** Sweet spot band as percent of FTP, from intervals.icu `sweet_spot_min` / `sweet_spot_max`. */
  sweetSpotPct: { min: number; max: number };
}

export interface PowerStream {
  /** Seconds since the start for each sample. */
  time: readonly number[];
  watts: ReadonlyArray<number | null>;
  /** Strava's `moving` stream. When absent, every sample with watts counts. */
  moving?: ReadonlyArray<boolean> | null;
}

export interface ComputedPowerZones {
  /** Seven zone seconds, Z1..Z7. */
  power: number[];
  /** Seconds inside the sweet spot band. Overlaps Z3/Z4, so it is never added to them. */
  sweetSpotSeconds: number;
}

export const SMOOTHING_SECONDS = 5;
/** A hole longer than this in the samples is a dropout, not riding. */
const MAX_GAP_SECONDS = 5;

export function zonesFromPowerStream(s: PowerStream, cfg: PowerSettings): ComputedPowerZones | undefined {
  const n = Math.min(s.time.length, s.watts.length);
  if (n === 0 || !(cfg.ftp > 0) || cfg.zoneTopsPct.length < 6) return undefined;

  // Resample to 1 Hz: each second takes the latest sample at or before it, unless that sample is stale.
  const last = Math.floor(s.time[n - 1]!);
  const watts: Array<number | null> = new Array(last + 1).fill(null);
  const moving: boolean[] = new Array(last + 1).fill(true);
  let j = 0;
  for (let t = 0; t <= last; t++) {
    while (j + 1 < n && s.time[j + 1]! <= t) j++;
    if (s.time[j]! > t || t - s.time[j]! > MAX_GAP_SECONDS) continue;
    const w = s.watts[j];
    watts[t] = w === null || w === undefined || !Number.isFinite(w) ? null : w;
    if (s.moving && s.moving[j] === false) moving[t] = false;
  }

  const topsW = cfg.zoneTopsPct.slice(0, 6).map((p) => (cfg.ftp * p) / 100);
  const ssLo = Math.floor((cfg.ftp * cfg.sweetSpotPct.min) / 100);
  const ssHi = Math.floor((cfg.ftp * cfg.sweetSpotPct.max) / 100);
  const power = [0, 0, 0, 0, 0, 0, 0];
  let sweetSpotSeconds = 0;
  let any = false;
  for (let t = 0; t <= last; t++) {
    if (!moving[t] || watts[t] === null) continue;
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, t - SMOOTHING_SECONDS + 1); k <= t; k++) {
      const w = watts[k];
      if (w !== null && w !== undefined) {
        sum += w;
        count++;
      }
    }
    const x = Math.round(sum / count);
    any = true;
    let z = topsW.findIndex((top) => x <= top);
    if (z < 0) z = 6;
    power[z]! += 1;
    if (x >= ssLo && x <= ssHi) sweetSpotSeconds += 1;
  }
  return any ? { power, sweetSpotSeconds } : undefined;
}
