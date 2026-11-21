import type { IntervalsActivity } from "@sweetspot/engine";

/**
 * Which activities each source supplies. Applied when the app reads stored
 * activities, so changing it needs no re-sync.
 *
 * Default: intervals.icu supplies everything it has (Garmin brings zone times
 * and power). Strava supplies strength and Zwift rides (VirtualRide), neither of
 * which reaches intervals.icu through Garmin. A Strava ride's zones are computed
 * from its power stream at sync time (powerzones.ts).
 * Widen Strava with ACTIVITY_SOURCES, e.g. {"strava":{"types":["WeightTraining","Yoga"]}},
 * give a source "types": "*" for all of its activities, or [] to turn it off.
 *
 * If both sources hold the same activity (same day, start within DEDUPE_MINUTES),
 * the intervals.icu one wins because it carries the zone data.
 *
 * Strava rows are private to the signed-in athlete (Strava API terms; AGENTS rule 3).
 * Nothing that reads through this module may feed a public view.
 */
export type TypeFilter = readonly string[] | "*";

export interface ActivityRouting {
  intervals: { types: TypeFilter };
  strava: { types: TypeFilter };
}

export const DEFAULT_ROUTING: ActivityRouting = {
  intervals: { types: "*" },
  strava: { types: ["WeightTraining", "VirtualRide"] },
};

export const DEDUPE_MINUTES = 10;

export type Source = "intervals" | "strava";

export interface SourcedActivity {
  id: string;
  date: string;
  type: string | null;
  source: Source;
  raw: IntervalsActivity;
}

const isFilter = (v: unknown): v is TypeFilter => v === "*" || (Array.isArray(v) && v.every((x) => typeof x === "string"));

/** Merge an ACTIVITY_SOURCES JSON override over the defaults. Bad JSON throws, so a typo can't silently drop a source. */
export function routingFromEnv(src: Record<string, string | undefined> = process.env): ActivityRouting {
  const raw = src.ACTIVITY_SOURCES;
  if (!raw) return DEFAULT_ROUTING;
  const o = JSON.parse(raw) as Partial<Record<Source, { types?: unknown }>>;
  const out: ActivityRouting = { intervals: { ...DEFAULT_ROUTING.intervals }, strava: { ...DEFAULT_ROUTING.strava } };
  for (const s of ["intervals", "strava"] as const) {
    const t = o[s]?.types;
    if (t === undefined) continue;
    if (!isFilter(t)) throw new Error(`ACTIVITY_SOURCES.${s}.types must be "*" or an array of activity types`);
    out[s] = { types: t };
  }
  return out;
}

const allows = (f: TypeFilter, type: string | null) => f === "*" || (type !== null && f.includes(type));

function startMs(a: SourcedActivity): number | null {
  const t = a.raw.start_date_local;
  if (!t || t.length < 16) return null;
  // Both sides are local wall-clock times (Strava labels local time with a Z), so compare them in one fake zone.
  const ms = Date.parse(t.slice(0, 19) + "Z");
  return Number.isNaN(ms) ? null : ms;
}

/** Keep what each source is configured to supply, then drop Strava duplicates of intervals.icu activities. */
export function selectActivities(rows: readonly SourcedActivity[], routing: ActivityRouting = DEFAULT_ROUTING): SourcedActivity[] {
  const kept = rows.filter((r) => allows(routing[r.source].types, r.type));
  const icu = kept.filter((r) => r.source === "intervals");
  return kept.filter((r) => {
    if (r.source !== "strava") return true;
    const t = startMs(r);
    return !icu.some((i) => {
      if (i.date !== r.date) return false;
      const ti = startMs(i);
      return t !== null && ti !== null && Math.abs(t - ti) <= DEDUPE_MINUTES * 60_000;
    });
  });
}
