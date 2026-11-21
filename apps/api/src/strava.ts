import type { IntervalsActivity } from "@sweetspot/engine";
import type { Repo } from "./repo";

/**
 * Strava API client: OAuth refresh and the activity list, with plain fetch.
 * Used for what Garmin never sends to intervals.icu, mainly strength sessions.
 * Strava data stays private to the signed-in athlete and is never used to train a model.
 * Errors carry the HTTP status only, never a URL, token or secret.
 */

export interface StravaToken {
  refreshToken: string;
  accessToken: string | null;
  expiresAt: Date | null;
}

export interface StravaTokenStore {
  get(): Promise<StravaToken | null>;
  save(t: StravaToken): Promise<void>;
}

export interface StravaConfig {
  clientId: string;
  clientSecret: string;
  tokens: StravaTokenStore;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Wait between retries; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

const API = "https://www.strava.com/api/v3";
const TOKEN_URL = "https://www.strava.com/oauth/token";

export function stravaCredsFromEnv(src: Record<string, string | undefined> = process.env): { clientId: string; clientSecret: string } | null {
  const clientId = src.STRAVA_CLIENT_ID;
  const clientSecret = src.STRAVA_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Strava config backed by the repo's token row, or null when STRAVA_CLIENT_ID/SECRET aren't set. */
export function stravaConfigFromEnv(repo: Repo, src: Record<string, string | undefined> = process.env): StravaConfig | null {
  const creds = stravaCredsFromEnv(src);
  if (!creds) return null;
  return { ...creds, tokens: { get: () => repo.stravaToken(), save: (t) => repo.saveStravaToken(t) } };
}

export function authorizeUrl(clientId: string, redirectUri: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", approval_prompt: "auto", scope: "read,activity:read_all" });
  return `https://www.strava.com/oauth/authorize?${q}`;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 500;

/**
 * fetch with a short retry on network errors (ECONNRESET and the like), HTTP 429 and 5xx.
 * Other 4xx come back at once. Backoff doubles from 500 ms. The last response or error is surfaced.
 */
async function fetchWithRetry(cfg: StravaConfig, url: string, init?: RequestInit): Promise<Response> {
  const f = cfg.fetch ?? fetch;
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await f(url, init);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) return res;
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) throw e;
    }
    await sleep(BACKOFF_MS * 2 ** (attempt - 1));
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

async function tokenRequest(cfg: StravaConfig, body: Record<string, string>): Promise<StravaToken> {
  const res = await fetchWithRetry(cfg, TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }),
  });
  if (!res.ok) throw new Error(`strava token -> HTTP ${res.status}`);
  const j = (await res.json()) as Partial<TokenResponse>;
  if (!j.access_token || !j.refresh_token || typeof j.expires_at !== "number") throw new Error("strava token: unexpected response");
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: new Date(j.expires_at * 1000) };
}

/** One-time: trade the authorization code from the redirect URL for tokens and store them. */
export async function exchangeCode(cfg: StravaConfig, code: string): Promise<void> {
  await cfg.tokens.save(await tokenRequest(cfg, { grant_type: "authorization_code", code }));
}

async function accessToken(cfg: StravaConfig): Promise<string> {
  const now = (cfg.now ?? (() => new Date()))();
  const t = await cfg.tokens.get();
  if (!t) throw new Error("strava is not authorized yet (run the strava-auth script)");
  if (t.accessToken && t.expiresAt && t.expiresAt.getTime() > now.getTime() + 60_000) return t.accessToken;
  const fresh = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: t.refreshToken });
  await cfg.tokens.save(fresh); // Strava can rotate the refresh token, so always keep the newest.
  return fresh.accessToken!;
}

interface StravaActivity {
  id?: number;
  name?: string;
  type?: string;
  sport_type?: string;
  start_date_local?: string;
  moving_time?: number;
  device_watts?: boolean;
}

/** Strava's shape in the engine's activity shape. Zones stay absent, so a Strava ride is `unknown`, never guessed. */
export function toActivity(a: StravaActivity): (IntervalsActivity & { name?: string }) | null {
  if (a.id === undefined || !a.start_date_local) return null;
  return {
    id: `strava:${a.id}`,
    type: a.sport_type ?? a.type,
    source: "STRAVA",
    name: a.name,
    start_date_local: a.start_date_local,
    moving_time: a.moving_time,
    ...(a.device_watts !== undefined ? { device_watts: a.device_watts } : {}),
  };
}

/** Activities whose local date is between `oldest` and `newest` (Denver dates, inclusive). */
export async function fetchStravaActivities(cfg: StravaConfig, oldest: string, newest: string): Promise<IntervalsActivity[]> {
  const token = await accessToken(cfg);
  // A day of slack each side: Strava filters on a UTC epoch, we filter on the local date afterwards.
  const after = Math.floor(Date.parse(`${oldest}T00:00:00Z`) / 1000) - 86_400;
  const before = Math.floor(Date.parse(`${newest}T23:59:59Z`) / 1000) + 86_400;
  const out: IntervalsActivity[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetchWithRetry(cfg, `${API}/athlete/activities?after=${after}&before=${before}&per_page=100&page=${page}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`strava activities -> HTTP ${res.status}`);
    const rows = (await res.json()) as StravaActivity[];
    if (!Array.isArray(rows)) throw new Error("strava activities: expected an array");
    for (const r of rows) {
      const a = toActivity(r);
      const d = a?.start_date_local?.slice(0, 10);
      if (a && d && d >= oldest && d <= newest) out.push(a);
    }
    if (rows.length < 100) break;
  }
  return out;
}

export interface StravaPowerStream {
  time: number[];
  watts: Array<number | null>;
  moving: boolean[] | null;
}

/** One activity's power stream (one extra call per ride). Null when the ride has no watts stream. */
export async function fetchPowerStream(cfg: StravaConfig, stravaId: string | number): Promise<StravaPowerStream | null> {
  const token = await accessToken(cfg);
  const id = String(stravaId).replace(/^strava:/, "");
  const res = await fetchWithRetry(cfg, `${API}/activities/${encodeURIComponent(id)}/streams?keys=time,watts,moving&key_by_type=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null; // no streams for this activity
  if (!res.ok) throw new Error(`strava streams -> HTTP ${res.status}`);
  const j = (await res.json()) as { time?: { data?: number[] }; watts?: { data?: Array<number | null> }; moving?: { data?: boolean[] } };
  const time = j.time?.data;
  const watts = j.watts?.data;
  return Array.isArray(time) && Array.isArray(watts) && watts.length > 0 ? { time, watts, moving: Array.isArray(j.moving?.data) ? j.moving!.data! : null } : null;
}
