import { describe, expect, it } from "vitest";
import { HR_LOAD_FACTOR, ownFatigueOn, rideLoad } from "../src/fatigue";

const S = { ftp: 250, thresholdHr: 170 };

describe("rideLoad", () => {
  it("one hour at FTP is 100", () => {
    expect(rideLoad({ date: "2026-11-01", movingSeconds: 3600, normalizedWatts: 250 }, S)).toEqual({ load: 100, method: "power" });
  });
  it("scales with IF squared", () => {
    const r = rideLoad({ date: "2026-11-01", movingSeconds: 3600, normalizedWatts: 125 }, S);
    expect(r.load).toBeCloseTo(25, 6);
  });
  it("prefers power over HR", () => {
    expect(rideLoad({ date: "d", movingSeconds: 3600, normalizedWatts: 250, avgHr: 100 }, S).method).toBe("power");
  });
  it("falls back to an HR estimate", () => {
    const r = rideLoad({ date: "d", movingSeconds: 3600, avgHr: 170 }, S);
    expect(r.method).toBe("hr");
    expect(r.load).toBeCloseTo(100 * HR_LOAD_FACTOR, 6);
  });
  it("is unknown without power or usable HR, never a guess", () => {
    expect(rideLoad({ date: "d", movingSeconds: 3600 }, S)).toEqual({ load: null, method: "unknown" });
    expect(rideLoad({ date: "d", movingSeconds: 3600, avgHr: 150 }, { ftp: 250 })).toEqual({ load: null, method: "unknown" });
    expect(rideLoad({ date: "d", movingSeconds: 0, normalizedWatts: 250 }, S).method).toBe("unknown");
  });
});

describe("ownFatigueOn", () => {
  const ride = (date: string, w = 250, sec = 3600) => ({ date, movingSeconds: sec, normalizedWatts: w });

  it("is null with no rides on or before the date", () => {
    expect(ownFatigueOn([], S, "2026-11-10")).toBeNull();
    expect(ownFatigueOn([ride("2026-11-12")], S, "2026-11-10")).toBeNull();
  });
  it("ATL reacts faster than CTL after a single ride", () => {
    const f = ownFatigueOn([ride("2026-11-01")], S, "2026-11-01")!;
    expect(f.fitness).toBeCloseTo(100 * (1 - Math.exp(-1 / 42)), 1);
    expect(f.fatigue).toBeCloseTo(100 * (1 - Math.exp(-1 / 7)), 1);
    expect(f.form).toBeLessThan(0);
  });
  it("rest days decay: Form rises after days off", () => {
    const rides = [ride("2026-11-01")];
    const d0 = ownFatigueOn(rides, S, "2026-11-01")!;
    const d5 = ownFatigueOn(rides, S, "2026-11-06")!;
    expect(d5.form).toBeGreaterThan(d0.form);
    expect(d5.fatigue).toBeLessThan(d0.fatigue);
  });
  it("sums two rides on one day", () => {
    const one = ownFatigueOn([ride("2026-11-01", 250, 7200)], S, "2026-11-01")!;
    const two = ownFatigueOn([ride("2026-11-01"), ride("2026-11-01")], S, "2026-11-01")!;
    expect(two.fitness).toBe(one.fitness);
  });
  it("ramp is CTL now minus CTL seven days ago", () => {
    const rides = Array.from({ length: 14 }, (_, i) => ride(`2026-11-${String(i + 1).padStart(2, "0")}`));
    const now = ownFatigueOn(rides, S, "2026-11-14")!;
    const before = ownFatigueOn(rides, S, "2026-11-07")!;
    expect(Math.abs(now.rampRate - (now.fitness - before.fitness))).toBeLessThanOrEqual(0.1); // each value is rounded to 0.1
    expect(now.rampRate).toBeGreaterThan(0);
  });
  it("counts unknown and HR-estimated rides, and adds no load for unknown", () => {
    const rides = [
      ride("2026-11-01"),
      { date: "2026-11-02", movingSeconds: 3600 },
      { date: "2026-11-03", movingSeconds: 3600, avgHr: 150 },
    ];
    const f = ownFatigueOn(rides, S, "2026-11-03")!;
    expect(f.unknownRides).toBe(1);
    expect(f.hrEstimatedRides).toBe(1);
    expect(f.historyDays).toBe(2);
  });
  it("ignores rides after the date and honours a seed", () => {
    const f = ownFatigueOn([ride("2026-11-05")], S, "2026-11-01", { date: "2026-10-01", fitness: 40, fatigue: 30 });
    expect(f).not.toBeNull();
    expect(f!.fitness).toBeLessThan(40);
    expect(f!.unknownRides).toBe(0);
  });
});

import { fatigueFor } from "../src/fatigue";
import { mapLoadRides } from "../src/intervals";

describe("mapLoadRides", () => {
  const base = { type: "VirtualRide", start_date_local: "2026-11-20T06:00:00", moving_time: 3600 };
  it("reads Strava and intervals.icu normalized power and average HR", () => {
    const rides = mapLoadRides([
      { ...base, id: 1, weighted_average_watts: 200, device_watts: true },
      { ...base, id: 2, icu_weighted_avg_watts: 210 },
      { ...base, id: 3, average_heartrate: 140 },
    ]);
    expect(rides.map((r) => [r.normalizedWatts, r.avgHr])).toEqual([[200, null], [210, null], [null, 140]]);
  });
  it("ignores estimated power and non-rides", () => {
    const rides = mapLoadRides([
      { ...base, id: 1, weighted_average_watts: 200, device_watts: false },
      { ...base, id: 2, type: "WeightTraining", weighted_average_watts: 100 },
    ]);
    expect(rides).toHaveLength(1);
    expect(rides[0]!.normalizedWatts).toBeNull();
  });
});

describe("fatigueFor", () => {
  const wellness = [{ id: "2026-10-31", ctl: 40, atl: 45 }, { id: "2026-11-10", ctl: 30, atl: 20, rampRate: 1 }];
  const rides = [{ date: "2026-11-02", movingSeconds: 3600, normalizedWatts: 250 }];
  it("uses own load seeded from the day before the program, and counts only later rides", () => {
    const r = fatigueFor({ rides, settings: S, wellness, programStart: "2026-11-01" }, "2026-11-02")!;
    expect(r.source).toBe("own");
    expect(r.fatigue.fitness).toBeGreaterThan(40); // 40 decays a day, then a 100-load ride lifts it
    expect(r.fatigue.date).toBe("2026-11-02");
    expect(r.note).toBeNull();
  });
  it("notes unknown rides and short unseeded history", () => {
    const r = fatigueFor({ rides: [...rides, { date: "2026-11-03", movingSeconds: 3600 }], settings: S, wellness: [], programStart: "2026-11-01" }, "2026-11-04")!;
    expect(r.note).toContain("1 ride with no power or heart rate");
    expect(r.note).toContain("warming up");
  });
  it("falls back to intervals.icu wellness without FTP", () => {
    const r = fatigueFor({ rides, settings: null, wellness, programStart: "2026-11-01" }, "2026-11-10")!;
    expect(r.source).toBe("intervals");
    expect(r.fatigue.form).toBe(10);
  });
  it("is null with nothing to read", () => {
    expect(fatigueFor({ rides: [], settings: S, wellness: [], programStart: "2026-11-01" }, "2026-11-04")).toBeNull();
  });
});
