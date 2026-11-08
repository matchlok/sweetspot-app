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
