import { describe, expect, it } from "vitest";
import { addDays, denverToday, mondayOf, weekdayMon0 } from "../src/dates";

describe("dates", () => {
  it("computes weekdays from the date", () => {
    expect(weekdayMon0("2026-11-08")).toBe(6); // Sunday
    expect(weekdayMon0("2026-11-09")).toBe(0); // Monday
  });
  it("finds Monday across a DST change (2026-11-01)", () => {
    expect(mondayOf("2026-11-04")).toBe("2026-11-02");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
  });
  it("adds days without drift", () => {
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
  });
  it("uses the Denver date, not UTC", () => {
    // 2026-11-09 03:00 UTC is still Nov 8 at 8 pm MST.
    expect(denverToday(new Date("2026-11-09T03:00:00Z"))).toBe("2026-11-08");
  });
});
