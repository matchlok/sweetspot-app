import type { CalendarEvent, IntervalsActivity, WellnessRow } from "@sweetspot/engine";
import { fetchEvents, type GoogleConfig } from "./google";

/** Everything fetched from outside. Routes take this interface so tests can fake it. */
export interface Sources {
  events(oldest: string, newest: string): Promise<CalendarEvent[]>;
  activities(oldest: string, newest: string): Promise<IntervalsActivity[]>;
  wellness(oldest: string, newest: string): Promise<WellnessRow[]>;
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

export function liveSources(google: GoogleConfig, intervals: IntervalsCreds): Sources {
  return {
    events: (o, n) => fetchEvents(google, o, n),
    activities: (o, n) => icu<IntervalsActivity>(intervals, "activities", o, n),
    wellness: (o, n) => icu<WellnessRow>(intervals, "wellness", o, n),
  };
}

export function intervalsFromEnv(src: Record<string, string | undefined> = process.env): IntervalsCreds {
  const apiKey = src.INTERVALS_API_KEY;
  const athleteId = src.INTERVALS_ATHLETE_ID;
  if (!apiKey) throw new Error("INTERVALS_API_KEY is not set");
  if (!athleteId) throw new Error("INTERVALS_ATHLETE_ID is not set");
  return { apiKey, athleteId };
}
