import { describe, expect, it } from "vitest";
import { categorize, categorizeActivity } from "../src/categorize";

const min = (...m: number[]) => m.map((x) => x * 60);

describe("categorize (heartrate)", () => {
  it("is unknown with no time in zone", () => {
    expect(categorize("heartrate", [0, 0, 0, 0, 0, 0, 0])).toBe("unknown");
  });
  it("vo2 when Z5 >= 3 min and >= 4% share", () => {
    expect(categorize("heartrate", min(20, 20, 5, 5, 4, 0, 0))).toBe("vo2");
  });
  it("long hilly endurance ride with small Z5 share stays endurance", () => {
    expect(categorize("heartrate", min(60, 100, 20, 5, 4, 0, 0))).toBe("endurance");
  });
  it("HR-lag path: short interval session with Z4+Z5 >= 14 and Z5 >= 1.5", () => {
    expect(categorize("heartrate", min(10, 20, 10, 12, 2, 0, 0))).toBe("vo2");
  });
  it("sweet spot when Z4 >= 8 min", () => {
    expect(categorize("heartrate", min(20, 30, 10, 8, 0, 0, 0))).toBe("sweet_spot");
  });
  it("endurance otherwise", () => {
    expect(categorize("heartrate", min(30, 40, 5, 2, 0, 0, 0))).toBe("endurance");
  });
});

describe("categorize (power)", () => {
  it("vo2 is Z5 only; Z6/Z7 (anaerobic, neuromuscular) don't count", () => {
    expect(categorize("power", min(10, 20, 5, 5, 5, 0, 0))).toBe("vo2");
    expect(categorize("power", min(10, 20, 5, 5, 2, 2, 1))).toBe("endurance"); // 5 min Z5+Z6+Z7, only 2 in Z5
    expect(categorize("power", min(10, 20, 5, 5, 0, 8, 4))).toBe("endurance");
  });
  it("sweet spot is Z4 plus half of Z3", () => {
    expect(categorize("power", min(10, 20, 8, 6, 0, 0, 0))).toBe("sweet_spot");
    expect(categorize("power", min(10, 20, 8, 5, 0, 0, 0))).toBe("endurance");
  });
});

describe("categorizeActivity", () => {
  it("prefers power over heartrate", () => {
    const r = categorizeActivity({
      power: min(10, 20, 5, 5, 6, 0, 0),
      heartrate: min(30, 40, 5, 2, 0, 0, 0),
    });
    expect(r).toEqual({ category: "vo2", source: "power" });
  });
  it("falls back to heartrate", () => {
    const r = categorizeActivity({ heartrate: min(20, 30, 10, 8, 0, 0, 0) });
    expect(r).toEqual({ category: "sweet_spot", source: "heartrate" });
  });
  it("no zones is unknown, not a guess", () => {
    expect(categorizeActivity({})).toEqual({ category: "unknown", source: null });
  });
});
