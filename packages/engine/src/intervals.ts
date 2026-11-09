import { categorizeActivity, type Category, type ZoneSource } from "./categorize";
import type { ActivityZones } from "./scorecard";

/**
 * intervals.icu adapter. Fetching is injected so tests (and the app) control
 * the network. intervals.icu owns zones and FTP: we read each ride's stored
 * zones and never hold zone settings locally.
 *
 * Field shapes follow scripts/spike/intervals-spike.mjs and the API docs as
 * understood on 2026-11-08. UNVERIFIED against live data: `icu_zone_times`
 * (power) shape and whether `device_watts` marks real sensor power. Re-check
 * against data/private/intervals-spike.json.
 * Checked on live data 2026-11-08: `icu_zone_times` is id-keyed Z1..Z7 plus an
 * "SS" entry; `device_watts` is true or null, never false, on 20 rides.
 */

export interface IntervalsActivity {
  id?: string | number;
  type?: string;
  source?: string;
  start_date_local?: string;
  moving_time?: number;
  /** Strava-sourced stub rows carry a note and no data. */
  _note?: string;
  /** 7 HR zone times in seconds. */
  icu_hr_zone_times?: number[] | null;
  /** Power zone times: [{id, secs}] or plain seconds. */
  icu_zone_times?: Array<{ id?: string; secs?: number } | number> | null;
  /** false when power is estimated rather than from a sensor. */
  device_watts?: boolean | null;
}

export const RIDE_TYPES = new Set([
  "Ride",
  "MountainBikeRide",
  "VirtualRide",
  "EBikeRide",
  "GravelRide",
  "Cyclocross",
]);

export interface RideZones {
  id: string;
  /** America/Denver local date, "YYYY-MM-DD". */
  date: string;
  movingSeconds: number;
  /** Seven HR zone seconds, or undefined when the ride has none. */
  heartrate?: number[];
  /** Seven power zone seconds, or undefined without sensor power. */
  power?: number[];
  /** Seconds at 88-94% FTP (overlaps power Z3/Z4); undefined without power. */
  sweetSpotSeconds?: number;
  category: Category;
  categorySource: ZoneSource | null;
}

const nonNeg = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

function hrZones(a: IntervalsActivity): number[] | undefined {
  const z = a.icu_hr_zone_times;
  if (!Array.isArray(z) || z.length === 0) return undefined;
  // Z1..Z7 as returned; time past Z7 doesn't exist. Z5+Z6+Z7 fold happens in the scorecard.
  const seven = [0, 1, 2, 3, 4, 5, 6].map((i) => nonNeg(z[i]));
  return seven.some((s) => s > 0) ? seven : undefined;
}

/** Seconds in intervals.icu's "SS" entry (88-94% FTP), which overlaps Z3/Z4. */
function sweetSpotSeconds(a: IntervalsActivity): number | undefined {
  if (a.device_watts === false || !Array.isArray(a.icu_zone_times)) return undefined;
  const e = a.icu_zone_times.find((x) => typeof x === "object" && x && x.id === "SS");
  return typeof e === "object" && e ? nonNeg(e.secs) : undefined;
}

function powerZones(a: IntervalsActivity): number[] | undefined {
  if (a.device_watts === false) return undefined; // estimated power is not a zone source
  const z = a.icu_zone_times;
  if (!Array.isArray(z) || z.length === 0) return undefined;
  // Live data (checked 2026-11-08) is [{id:"Z1",secs}, ..., {id:"Z7",secs}, {id:"SS",secs}]:
  // 8 entries, the extra "SS" overlaps Z3/Z4. Read by id so order and extras can't shift zones.
  const byId = new Map<string, number>();
  for (const e of z) {
    if (typeof e === "object" && e && typeof e.id === "string") byId.set(e.id, nonNeg(e.secs));
  }
  const seven =
    byId.has("Z1")
      ? [1, 2, 3, 4, 5, 6, 7].map((n) => byId.get(`Z${n}`) ?? 0)
      : // Plain seconds or id-less entries: positional, first seven only.
        [0, 1, 2, 3, 4, 5, 6].map((i) => {
          const e = z[i];
          return typeof e === "number" ? nonNeg(e) : nonNeg(e?.secs);
        });
  return seven.some((s) => s > 0) ? seven : undefined;
}

/** Map one raw activity to engine input; null for non-rides and stub rows. */
export function mapActivity(a: IntervalsActivity): RideZones | null {
  if (!a.type || !RIDE_TYPES.has(a.type) || a._note) return null;
  const date = a.start_date_local?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null; // already athlete-local; never re-zone
  const heartrate = hrZones(a);
  const power = powerZones(a);
  const { category, source } = categorizeActivity({ power, heartrate });
  return {
    id: String(a.id ?? `${date}-${a.moving_time ?? 0}`),
    date,
    movingSeconds: nonNeg(a.moving_time),
    heartrate,
    power,
    sweetSpotSeconds: power ? sweetSpotSeconds(a) : undefined,
    category,
    categorySource: source,
  };
}

export function mapActivities(raw: readonly IntervalsActivity[]): RideZones[] {
  return raw.flatMap((a) => mapActivity(a) ?? []);
}

/** Shape the scorecard expects. It prefers power per ride and falls back to HR. */
export function toActivityZones(rides: readonly RideZones[]): ActivityZones[] {
  return rides.map((r) => ({ date: r.date, heartrate: r.heartrate,
    power: r.power,
    sweetSpotSeconds: r.sweetSpotSeconds,
  }));
}

export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface IntervalsConfig {
  apiKey: string;
  athleteId: string;
  fetch?: Fetcher;
}

/** Fetch activities between two Denver dates (inclusive) and map them. */
export async function fetchRides(
  cfg: IntervalsConfig,
  oldest: string,
  newest: string,
): Promise<RideZones[]> {
  const f = cfg.fetch ?? (globalThis.fetch as unknown as Fetcher);
  const auth = "Basic " + Buffer.from(`API_KEY:${cfg.apiKey}`).toString("base64");
  const url = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(cfg.athleteId)}/activities?oldest=${oldest}&newest=${newest}`;
  const res = await f(url, { headers: { Authorization: auth } });
  // Status only: never echo the URL's credentials or headers into errors.
  if (!res.ok) throw new Error(`intervals.icu activities -> HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error("intervals.icu activities: expected an array");
  return mapActivities(body as IntervalsActivity[]);
}
