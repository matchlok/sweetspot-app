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
  it("reads power zones by id, ignoring the SS entry and entry order", () => {
    // Shape from live intervals.icu data (2026-11-08): Z1..Z7 plus "SS".
    const live = [
      { id: "Z1", secs: 667 }, { id: "Z2", secs: 1849 }, { id: "Z3", secs: 644 }, { id: "Z4", secs: 82 },
      { id: "Z5", secs: 9 }, { id: "Z6", secs: 24 }, { id: "Z7", secs: 0 }, { id: "SS", secs: 209 },
    ];
    const ride = { type: "Ride", start_date_local: "2026-11-04T06:10:00", device_watts: true as const };
    const inOrder = mapActivity({ ...ride, icu_zone_times: live });
    const shuffled = mapActivity({ ...ride, icu_zone_times: [...live].reverse() });
    expect(inOrder?.power).toEqual([667, 1849, 644, 82, 9, 24, 0]);
    expect(inOrder?.sweetSpotSeconds).toBe(209);
    expect(toActivityZones([inOrder!])[0]?.sweetSpotSeconds).toBe(209);
    expect(shuffled?.power).toEqual(inOrder?.power);
  });
  it("prefers sensor power; ignores estimated power", () => {
    const base = {
      type: "Ride",
      start_date_local: "2026-11-03T06:10:00",
      icu_hr_zone_times: min(30, 40, 5, 2, 0, 0, 0),
      icu_zone_times: [600, 1200, 300, 300, 360, 120, 60].map((secs, i) => ({ id: `Z${i + 1}`, secs })),
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
  it("rides without zones stay out of scorecard input", () => {
    const r = mapActivity({ type: "Ride", start_date_local: "2026-11-04T10:00:00" })!;
    expect(toActivityZones([r])).toEqual([{ date: "2026-11-04", heartrate: undefined, power: undefined }]);
  });
  it("passes sensor power to the scorecard and drops estimated power", () => {
    const base = {
      type: "Ride",
      start_date_local: "2026-11-03T06:10:00",
      icu_hr_zone_times: min(30, 40, 5, 2, 0, 0, 0),
      icu_zone_times: [600, 1200, 300, 300, 120, 120, 60].map((secs, i) => ({ id: `Z${i + 1}`, secs })),
    };
    const [withPower] = toActivityZones([mapActivity({ ...base, device_watts: true })!]);
    expect(withPower?.power).toEqual([600, 1200, 300, 300, 120, 120, 60]);    const [estimated] = toActivityZones([mapActivity({ ...base, device_watts: false })!]);
    expect(estimated?.power).toBeUndefined();
    expect(estimated?.heartrate).toBeDefined();
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
