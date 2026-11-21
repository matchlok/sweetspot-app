import { zonesFromPowerStream, type CalendarEvent, type ComputedPowerZones, type IntervalsActivity, type LoadSettings, type PowerSettings, type WellnessRow } from "@sweetspot/engine";
import { fetchPowerStream, fetchStravaActivities, type StravaConfig } from "./strava";
import { fetchEvents, patchEvent, type EventPatch, type GoogleConfig } from "./google";

/** Everything fetched from outside. Routes take this interface so tests can fake it. */
export interface Sources {
  events(oldest: string, newest: string): Promise<CalendarEvent[]>;
  activities(oldest: string, newest: string): Promise<IntervalsActivity[]>;
  wellness(oldest: string, newest: string): Promise<WellnessRow[]>;
  /** FTP and threshold HR for the own load calculation. Absent in tests that don't need it. */
  loadSettings?(): Promise<LoadSettings | null>;
  /** Absent when Strava isn't configured. Private to the athlete; see routing.ts. */
  stravaActivities?(oldest: string, newest: string): Promise<IntervalsActivity[]>;
  /**
   * Zone seconds computed from one Strava ride's power stream against intervals.icu's FTP and zones.
   * Null when the ride has no power stream (so it stays `unknown`). Absent when Strava isn't configured.
   */
  stravaPowerZones?(stravaId: string): Promise<ComputedPowerZones | null>;
  /** Patch one calendar instance (a move or a skip). Never the series. */
  patchEvent(instanceId: string, patch: EventPatch): Promise<void>;
}

export interface IntervalsCreds {
  apiKey: string;
  athleteId: string;
  fetch?: typeof fetch;
}

async function icu<T>(c: IntervalsCreds, path: string, oldest: string, newest: string): Promise<T[]> {
  const f = c.fetch ?? fetch;
  const auth = "Basic " + Buffer.from(`API_KEY:${c.apiKey}`).toString("base64");
  const url = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(c.athleteId)}/${path}?oldest=${oldest}&newest=${newest}`;
  const res = await f(url, { headers: { Authorization: auth } });
  // Status only: never echo the URL or headers.
  if (!res.ok) throw new Error(`intervals.icu ${path} -> HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`intervals.icu ${path}: expected an array`);
  return body as T[];
}

/** FTP, zone tops and the sweet spot band for cycling, as intervals.icu holds them. */
export async function fetchPowerSettings(c: IntervalsCreds): Promise<PowerSettings> {
  const f = c.fetch ?? fetch;
  const auth = "Basic " + Buffer.from(`API_KEY:${c.apiKey}`).toString("base64");
  const res = await f(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(c.athleteId)}/sport-settings`, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`intervals.icu sport-settings -> HTTP ${res.status}`);
  const all = (await res.json()) as Array<{ types?: string[]; ftp?: number; power_zones?: number[]; sweet_spot_min?: number; sweet_spot_max?: number }>;
  const s = Array.isArray(all) ? all.find((x) => x.types?.includes("Ride")) : undefined;
  if (!s?.ftp || !Array.isArray(s.power_zones) || typeof s.sweet_spot_min !== "number" || typeof s.sweet_spot_max !== "number") {
    throw new Error("intervals.icu sport-settings: no cycling FTP or zones");
  }
  return { ftp: s.ftp, zoneTopsPct: s.power_zones, sweetSpotPct: { min: s.sweet_spot_min, max: s.sweet_spot_max } };
}

/** FTP and threshold HR (`lthr`) for cycling, as intervals.icu holds them. HR is null when unset. */
export async function fetchLoadSettings(c: IntervalsCreds): Promise<LoadSettings | null> {
  const f = c.fetch ?? fetch;
  const auth = "Basic " + Buffer.from(`API_KEY:${c.apiKey}`).toString("base64");
  const res = await f(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(c.athleteId)}/sport-settings`, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`intervals.icu sport-settings -> HTTP ${res.status}`);
  const all = (await res.json()) as Array<{ types?: string[]; ftp?: number; lthr?: number }>;
  const s = Array.isArray(all) ? all.find((x) => x.types?.includes("Ride")) : undefined;
  return s?.ftp ? { ftp: s.ftp, thresholdHr: s.lthr ?? null } : null;
}

export function liveSources(google: GoogleConfig, intervals: IntervalsCreds, strava?: StravaConfig | null): Sources {
  return {
    ...(strava
      ? {
          stravaActivities: (o: string, n: string) => fetchStravaActivities(strava, o, n),
          stravaPowerZones: async (id: string) => {
            const stream = await fetchPowerStream(strava, id);
            return stream ? (zonesFromPowerStream(stream, await fetchPowerSettings(intervals)) ?? null) : null;
          },
        }
      : {}),
    events: (o, n) => fetchEvents(google, o, n),
    activities: (o, n) => icu<IntervalsActivity>(intervals, "activities", o, n),
    wellness: (o, n) => icu<WellnessRow>(intervals, "wellness", o, n),
    loadSettings: () => fetchLoadSettings(intervals),
    patchEvent: (id, patch) => patchEvent(google, id, patch),
  };
}

export function intervalsFromEnv(src: Record<string, string | undefined> = process.env): IntervalsCreds {
  const apiKey = src.INTERVALS_API_KEY;
  const athleteId = src.INTERVALS_ATHLETE_ID;
  if (!apiKey) throw new Error("INTERVALS_API_KEY is not set");
  if (!athleteId) throw new Error("INTERVALS_ATHLETE_ID is not set");
  return { apiKey, athleteId };
}
