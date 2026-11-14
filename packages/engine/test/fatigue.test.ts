import { describe, expect, it } from "vitest";
import { fatigueOn } from "../src/fatigue";

const rows = [
  { id: "2026-11-08", ctl: 30, atl: 40, rampRate: 2.5 },
  { id: "2026-11-09", ctl: 31, atl: 35.3 },
  { id: "2026-11-10", ctl: null, atl: null },
];

describe("fatigueOn", () => {
  it("computes Form as CTL minus ATL", () => {
    expect(fatigueOn(rows, "2026-11-08")).toEqual({ date: "2026-11-08", fitness: 30, fatigue: 40, form: -10, rampRate: 2.5 });
  });
  it("rounds Form and returns null ramp when absent", () => {
    expect(fatigueOn(rows, "2026-11-09")).toMatchObject({ form: -4.3, rampRate: null });
  });
  it("uses the latest usable row before the date and reports its date", () => {
    expect(fatigueOn(rows, "2026-11-10")!.date).toBe("2026-11-09");
  });
  it("is null when nothing usable exists", () => {
    expect(fatigueOn(rows, "2026-11-01")).toBeNull();
    expect(fatigueOn([], "2026-11-10")).toBeNull();
  });
});
