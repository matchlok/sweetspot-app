import { describe, expect, it } from "vitest";
import { fetchRides, mapActivity, toActivityZones, type Fetcher } from "../src/intervals";

const min = (...m: number[]) => m.map((x) => x * 60);

describe("mapActivity", () => {
  it("maps an HR-only ride and keeps the athlete-local date", () => {
    const r = mapActivity({
      id: 1,
      type: "MountainBikeRide",
      start_date_local: "2026-11-03T06:10:00",
      moving_time: 3600,
      icu_hr_zone_times: min(20, 30, 10, 8, 0, 0, 0),
    });
    expect(r).toMatchObject({ date: "2026-11-03", category: "sweet_spot", categorySource: "heartrate" });
  });
  it("prefers sensor power; ignores estimated power", () => {
    const base = {
      type: "Ride",
      start_date_local: "2026-11-03T06:10:00",
      icu_hr_zone_times: min(30, 40, 5, 2, 0, 0, 0),
      icu_zone_times: [{ id: "Z1", secs: 600 }, { secs: 1200 }, { secs: 300 }, { secs: 300 }, { secs: 120 }, { secs: 120 }, { secs: 60 }],
    };
    expect(mapActivity({ ...base, device_watts: true })).toMatchObject({ category: "vo2", categorySource: "power" });
    expect(mapActivity({ ...base, device_watts: false })).toMatchObject({ category: "endurance", categorySource: "heartrate" });
  });
  it("family ride with no zones is unknown, not a guess", () => {
    expect(mapActivity({ type: "Ride", start_date_local: "2026-11-04T10:00:00" })).toMatchObject({
      category: "unknown",
      categorySource: null,
    });
  });
  it("skips non-rides and stub rows", () => {
    expect(mapActivity({ type: "WeightTraining", start_date_local: "2026-11-03T06:00:00" })).toBeNull();
    expect(mapActivity({ type: "Ride", start_date_local: "2026-11-03T06:00:00", _note: "STRAVA" })).toBeNull();
  });
  it("rides without HR zones stay out of scorecard input", () => {
    const r = mapActivity({ type: "Ride", start_date_local: "2026-11-04T10:00:00" })!;
    expect(toActivityZones([r])).toEqual([{ date: "2026-11-04", heartrate: undefined }]);
  });
});

describe("fetchRides", () => {
  it("sends Basic auth, maps results, and reports status without secrets", async () => {
    let seen: { url: string; auth: string } | undefined;
    const ok: Fetcher = async (url, init) => {
      seen = { url, auth: init.headers.Authorization! };
      return { ok: true, status: 200, json: async () => [{ type: "Ride", start_date_local: "2026-11-03T06:00:00", icu_hr_zone_times: min(10, 10, 0, 0, 0, 0, 0) }] };
    };
    const rides = await fetchRides({ apiKey: "k", athleteId: "i1", fetch: ok }, "2026-11-02", "2026-11-08");
    expect(rides).toHaveLength(1);
    expect(seen?.url).toContain("/athlete/i1/activities?oldest=2026-11-02&newest=2026-11-08");
    expect(seen?.auth).toBe("Basic " + Buffer.from("API_KEY:k").toString("base64"));

    const bad: Fetcher = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await expect(fetchRides({ apiKey: "secret-key", athleteId: "i1", fetch: bad }, "a", "b")).rejects.toThrow(/HTTP 401$/);
  });
});
