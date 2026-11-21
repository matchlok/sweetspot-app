import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTING, routingFromEnv, selectActivities, type SourcedActivity } from "../src/routing";
import { syncActivities, loadViewData } from "../src/data";
import { memoryRepo } from "../src/repo";
import type { Sources } from "../src/sources";
import { fetchStravaActivities, toActivity, type StravaToken } from "../src/strava";

const act = (id: string, source: "intervals" | "strava", type: string, start: string): SourcedActivity => ({
  id,
  source,
  type,
  date: start.slice(0, 10),
  raw: { id, type, start_date_local: start, moving_time: 3000 },
});

describe("activity routing", () => {
  it("takes everything from intervals.icu and only strength from Strava by default", () => {
    const rows = [
      act("i1", "intervals", "Ride", "2026-11-17T07:00:00"),
      act("s1", "strava", "Ride", "2026-11-18T07:00:00"),
      act("s2", "strava", "WeightTraining", "2026-11-19T06:30:00"),
    ];
    expect(selectActivities(rows, DEFAULT_ROUTING).map((r) => r.id)).toEqual(["i1", "s2"]);
  });

  it("prefers the intervals.icu copy when both sources hold the same activity", () => {
    const rows = [
      act("i1", "intervals", "WeightTraining", "2026-11-19T06:30:00"),
      act("s1", "strava", "WeightTraining", "2026-11-19T06:34:00Z"),
      act("s2", "strava", "WeightTraining", "2026-11-19T17:30:00Z"),
    ];
    expect(selectActivities(rows, DEFAULT_ROUTING).map((r) => r.id)).toEqual(["i1", "s2"]);
  });

  it("is configurable per source", () => {
    const rows = [act("s1", "strava", "Ride", "2026-11-18T07:00:00"), act("i1", "intervals", "WeightTraining", "2026-11-19T07:00:00")];
    const routing = routingFromEnv({ ACTIVITY_SOURCES: '{"strava":{"types":"*"},"intervals":{"types":["Ride"]}}' });
    expect(selectActivities(rows, routing).map((r) => r.id)).toEqual(["s1"]);
    expect(selectActivities(rows, routingFromEnv({ ACTIVITY_SOURCES: '{"strava":{"types":[]}}' })).map((r) => r.id)).toEqual(["i1"]);
    expect(() => routingFromEnv({ ACTIVITY_SOURCES: '{"strava":{"types":5}}' })).toThrow();
    expect(routingFromEnv({})).toBe(DEFAULT_ROUTING);
  });
});

function stravaFetch(pages: unknown[][], log: string[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    log.push(u.includes("/oauth/token") ? "token" : "list");
    if (u.includes("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_at: 2_000_000_000 }), { status: 200 });
    }
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer a2");
    const page = Number(new URL(u).searchParams.get("page"));
    return new Response(JSON.stringify(pages[page - 1] ?? []), { status: 200 });
  }) as typeof fetch;
}

describe("strava client", () => {
  const stale: StravaToken = { refreshToken: "r1", accessToken: "a1", expiresAt: new Date("2020-01-01") };

  it("refreshes an expired token, keeps the rotated refresh token, and filters by local date", async () => {
    let stored: StravaToken | null = stale;
    const log: string[] = [];
    const lifts = [
      { id: 1, sport_type: "WeightTraining", type: "WeightTraining", name: "Lift", start_date_local: "2026-11-19T06:30:00Z", moving_time: 2400 },
      { id: 2, sport_type: "Ride", start_date_local: "2026-11-30T06:30:00Z", moving_time: 100 }, // outside range
    ];
    const out = await fetchStravaActivities(
      { clientId: "c", clientSecret: "s", tokens: { get: async () => stored, save: async (t) => void (stored = t) }, fetch: stravaFetch([lifts], log), now: () => new Date("2026-11-21T12:00:00Z") },
      "2026-11-14",
      "2026-11-21",
    );
    expect(log).toEqual(["token", "list"]);
    expect(stored?.refreshToken).toBe("r2");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "strava:1", type: "WeightTraining", source: "STRAVA", moving_time: 2400 });
  });

  it("reports only the status on failure", async () => {
    const f = (async () => new Response("secret body", { status: 401 })) as typeof fetch;
    await expect(
      fetchStravaActivities({ clientId: "c", clientSecret: "s", tokens: { get: async () => stale, save: async () => {} }, fetch: f }, "2026-11-14", "2026-11-21"),
    ).rejects.toThrow("strava token -> HTTP 401");
  });

  it("maps a Strava row to the engine shape without inventing zones", () => {
    const a = toActivity({ id: 9, type: "Ride", start_date_local: "2026-11-20T18:00:00Z", moving_time: 3600 })!;
    expect(a.icu_hr_zone_times).toBeUndefined();
    expect(a.icu_zone_times).toBeUndefined();
  });
});

describe("sync and read with two sources", () => {
  const now = () => new Date("2026-11-21T19:00:00Z");
  const mkSources = (strava?: Sources["stravaActivities"]): Sources => ({
    events: async () => [],
    activities: async () => [{ id: "i1", type: "Ride", start_date_local: "2026-11-20T18:00:00", moving_time: 3600 }],
    wellness: async () => [],
    patchEvent: async () => {},
    ...(strava ? { stravaActivities: strava } : {}),
  });
  const stravaRows = async () => [
    { id: "strava:5", type: "WeightTraining", start_date_local: "2026-11-20T06:30:00Z", moving_time: 2400 },
    { id: "strava:6", type: "Ride", start_date_local: "2026-11-21T06:30:00Z", moving_time: 2400 },
  ];

  it("stores both sources, tagged, and reads back only what routing allows", async () => {
    const repo = memoryRepo();
    const deps = { repo, sources: mkSources(stravaRows), now };
    await syncActivities(deps);
    expect([...repo.activitiesStore.values()].map((a) => `${a.id}:${a.source}`).sort()).toEqual(["i1:intervals", "strava:5:strava", "strava:6:strava"]);
    const d = await loadViewData(deps, "2026-11-21");
    expect(d.lifts.map((l) => l.id)).toEqual(["strava:5"]);
    expect(d.rides.map((r) => r.id)).toEqual(["i1"]); // the Strava ride is filtered out
  });

  it("keeps intervals.icu data and records the error when Strava fails", async () => {
    const repo = memoryRepo();
    const res = await syncActivities({
      repo,
      sources: mkSources(async () => {
        throw new Error("strava activities -> HTTP 429");
      }),
      now,
    });
    expect(res.newActivities).toBe(1);
    expect((await repo.syncState()).lastError).toBe("strava: strava activities -> HTTP 429");
  });

  it("works with no Strava source at all", async () => {
    const repo = memoryRepo();
    await syncActivities({ repo, sources: mkSources(), now });
    expect((await repo.syncState()).lastError).toBeNull();
  });
});
