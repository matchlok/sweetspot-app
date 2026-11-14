import { SignJWT, importPKCS8 } from "jose";
import type { CalendarEvent } from "@sweetspot/engine";

/**
 * Google Calendar through a service account, using plain fetch and `jose`
 * (no googleapis dependency). The Training calendar is shared with the
 * service account and queried by id, because shared calendars don't appear in
 * its calendarList (STATUS, 2026-11-08).
 */

export interface GoogleConfig {
  /** Parsed GOOGLE_SERVICE_ACCOUNT_JSON. */
  serviceAccount: { client_email: string; private_key: string; token_uri?: string };
  calendarId: string;
  fetch?: typeof fetch;
}

const SCOPE = "https://www.googleapis.com/auth/calendar";
const TOKEN_URI = "https://oauth2.googleapis.com/token";

export function googleConfigFromEnv(src: Record<string, string | undefined> = process.env): GoogleConfig {
  const raw = src.GOOGLE_SERVICE_ACCOUNT_JSON;
  const calendarId = src.GOOGLE_CALENDAR_ID;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID is not set");
  return { serviceAccount: JSON.parse(raw), calendarId };
}

let cached: { token: string; expires: number; email: string } | null = null;

export async function accessToken(cfg: GoogleConfig, now = Date.now()): Promise<string> {
  const sa = cfg.serviceAccount;
  if (cached && cached.email === sa.client_email && cached.expires > now + 60_000) return cached.token;
  const f = cfg.fetch ?? fetch;
  const uri = sa.token_uri ?? TOKEN_URI;
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(uri)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + 3600)
    .sign(key);
  const res = await f(uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  // Status only: never echo the assertion or key into errors.
  if (!res.ok) throw new Error(`Google token -> HTTP ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google token: no access_token");
  cached = { token: body.access_token, expires: now + (body.expires_in ?? 3600) * 1000, email: sa.client_email };
  return body.access_token;
}

/**
 * Event instances between two Denver dates (inclusive). `singleEvents` expands
 * the recurring series; `showDeleted` keeps cancelled instances, which the
 * reader treats as skips. All-day events use `date`, so the window is built
 * from dates, not instants, and never shifted across timezones.
 */
export async function fetchEvents(cfg: GoogleConfig, oldest: string, newest: string): Promise<CalendarEvent[]> {
  const f = cfg.fetch ?? fetch;
  const token = await accessToken(cfg);
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "true",
      maxResults: "250",
      timeMin: `${oldest}T00:00:00-07:00`,
      timeMax: `${nextDay(newest)}T00:00:00-07:00`,
      timeZone: "America/Denver",
    });
    if (pageToken) q.set("pageToken", pageToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events?${q}`;
    const res = await f(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Google Calendar events -> HTTP ${res.status}`);
    const body = (await res.json()) as { items?: CalendarEvent[]; nextPageToken?: string };
    out.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

function nextDay(d: string): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
