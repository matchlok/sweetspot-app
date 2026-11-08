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

function powerZones(a: IntervalsActivity): number[] | undefined {
  if (a.device_watts === false) return undefined; // estimated power is not a zone source
  const z = a.icu_zone_times;
  if (!Array.isArray(z) || z.length === 0) return undefined;
  const secs = z.map((e) => (typeof e === "number" ? nonNeg(e) : nonNeg(e?.secs)));
  const seven = [0, 1, 2, 3, 4, 5, 6].map((i) => secs[i] ?? 0);
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
    category,
    categorySource: source,
  };
}

export function mapActivities(raw: readonly IntervalsActivity[]): RideZones[] {
  return raw.flatMap((a) => mapActivity(a) ?? []);
}

/** Shape the scorecard expects. Rides without HR zones stay out of the HR totals. */
export function toActivityZones(rides: readonly RideZones[]): ActivityZones[] {
  return rides.map((r) => ({ date: r.date, heartrate: r.heartrate }));
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
