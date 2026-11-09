import { describe, expect, it } from "vitest";
import { weeklyZoneRows, zoneScorecard } from "../src/scorecard";

const min = (...m: number[]) => m.map((x) => x * 60);
const today = "2026-11-08"; // Sunday; week starts 2026-11-02

describe("weeklyZoneRows", () => {
  it("buckets by Mon-Sun week and folds Z6+Z7 into Z5", () => {
    const rows = weeklyZoneRows(
      [
        { date: "2026-11-02", heartrate: min(10, 20, 5, 5, 3, 1, 1) },
        { date: "2026-11-08", heartrate: min(30, 30, 0, 0, 0, 0, 0) },
        { date: "2026-11-01", heartrate: min(99, 0, 0, 0, 0, 0, 0) }, // prior week
        { date: "2026-11-03" }, // no zones: not counted
      ],
      today,
      2,
    );
    expect(rows[0]).toMatchObject({ start: "2026-11-02", rides: 2, z1: 2400, z2: 3000, z5: 300 });
    expect(rows[1]).toMatchObject({ start: "2026-10-26", rides: 1, z1: 5940 });
  });
});

describe("weeklyZoneRows with power", () => {
  it("uses power zones over HR per ride and falls back to HR without power", () => {
    const [w] = weeklyZoneRows(
      [
        // Has both: power wins, HR is ignored.
        { date: "2026-11-03", power: min(10, 20, 5, 10, 4, 1, 1), heartrate: min(60, 0, 0, 0, 0, 0, 0) },
        // HR only: counted from HR.
        { date: "2026-11-05", heartrate: min(0, 30, 0, 0, 0, 0, 0) },
        // Neither: not counted.
        { date: "2026-11-06" },
      ],
      today,
      1,
    );
    expect(w).toMatchObject({ rides: 2, powerRides: 1, z1: 600, z2: 3000, z3: 300, z4: 600, z5: 360 });
  });
});

describe("sweet spot reporting", () => {
  const row = (a: object) => weeklyZoneRows([{ date: "2026-11-03", ...a }], today, 1)[0]!;
  it("reports SS separately and leaves Z3/Z4 as recorded (live-data numbers)", () => {
    const w = row({ power: [667, 1849, 644, 82, 9, 24, 0], sweetSpotSeconds: 209 });
    expect(w).toMatchObject({ z3: 644, z4: 82, ssSeconds: 209 });
  });
  it("sums SS across power rides and ignores it on HR rides", () => {
    const [w] = weeklyZoneRows(
      [
        { date: "2026-11-03", power: min(0, 0, 10, 5, 0, 0, 0), sweetSpotSeconds: 600 },
        { date: "2026-11-05", power: min(0, 0, 0, 10, 0, 0, 0), sweetSpotSeconds: 300 },
        { date: "2026-11-06", heartrate: min(0, 0, 0, 20, 0, 0, 0), sweetSpotSeconds: 999 },
      ],
      today,
      1,
    );
    expect(w).toMatchObject({ ssSeconds: 900, z4: 900 + 1200 });
  });
  it("scorecard exposes ssMin without changing bands", () => {
    const plan = new Map([["2026-11-02", new Set(["sweet_spot"])]]);
    const [w] = weeklyZoneRows([{ date: "2026-11-03", power: min(0, 60, 20, 0, 0, 0, 0), sweetSpotSeconds: 900 }], today, 1);
    const [s] = zoneScorecard([w!], plan, today);
    expect(s).toMatchObject({ ssMin: 15, qualityMin: 0, qualityStatus: "below", z3Min: 20 });
  });
});

describe("goal minutes", () => {
  it("endurance is Z2+Z3 without Z1; VO2 is Z5 only without Z4 or Z6/Z7", () => {
    const [w] = weeklyZoneRows(
      [
        { date: "2026-11-03", power: min(15, 40, 10, 8, 4, 2, 1), sweetSpotSeconds: 300 },
        { date: "2026-11-05", heartrate: min(10, 30, 5, 6, 3, 1, 1) },
      ],
      today,
      1,
    );
    expect(w).toMatchObject({
      enduranceSeconds: (40 + 10 + 30 + 5) * 60,
      vo2Seconds: (4 + 3) * 60,
      ssSeconds: 300,
    });
    const plan = new Map([["2026-11-02", new Set(["vo2"])]]);
    const [s] = zoneScorecard([w!], plan, today);
    expect(s).toMatchObject({ enduranceMin: 85, vo2Min: 7, ssMin: 5, powerRides: 1, rides: 2 });
  });
});

describe("zoneScorecard", () => {
  const plan = new Map([["2026-11-02", new Set(["endurance", "sweet_spot"])]]);
  it("scores a normal week and flags tempo drift", () => {
    const [w] = weeklyZoneRows(
      [{ date: "2026-11-03", heartrate: min(10, 40, 45, 10, 5, 0, 0) }],
      today,
      1,
    );
    const [s] = zoneScorecard([w!], plan, today);
    expect(s).toMatchObject({
      kind: "normal",
      inProgress: true,
      easyStatus: "below", // 50 < 60
      qualityStatus: "ok", // 15 in 12-30
      tempoDrift: false, // z3 45 < easy 50
    });
  });
  it("uses recovery band when the plan has an easy_spin", () => {
    const rec = new Map([["2026-11-02", new Set(["easy_spin"])]]);
    const [w] = weeklyZoneRows([{ date: "2026-11-03", heartrate: min(20, 20, 0, 0, 0, 0, 0) }], today, 1);
    const [s] = zoneScorecard([w!], rec, today);
    expect(s).toMatchObject({ kind: "recovery", easyStatus: "ok", qualityStatus: null });
  });
  it("skips weeks with no plan", () => {
    const [w] = weeklyZoneRows([], today, 1);
    expect(zoneScorecard([w!], new Map(), today)).toEqual([]);
  });
});
