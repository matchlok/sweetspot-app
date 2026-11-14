import { describe, expect, it } from "vitest";
import type { PlannedSession } from "../src/calendar";
import { liftCounts, mapLifts, matchLifts, plannedGoals, sessionStatus } from "../src/plan";

const s = (
  id: string,
  date: string,
  kind: PlannedSession["kind"],
  status: PlannedSession["status"] = "planned",
): PlannedSession => ({ id, date, kind, title: id, minutes: null, status, kindSource: "title" });

describe("plannedGoals", () => {
  it("lists goals with a live session and ignores skips, lifts and easy spins", () => {
    const g = plannedGoals([
      s("a", "2026-11-10", "vo2"),
      s("b", "2026-11-11", "sweet_spot", "skipped"),
      s("c", "2026-11-12", "lift_upper"),
      s("d", "2026-11-13", "easy_spin"),
    ]);
    expect([...g]).toEqual(["vo2"]);
  });
});

describe("lifts", () => {
  const planned = [
    s("u", "2026-11-09", "lift_upper"),
    s("l", "2026-11-12", "lift_lower"),
    s("l2", "2026-11-13", "lift_lower", "skipped"),
  ];
  const lifts = mapLifts([
    { id: 1, type: "WeightTraining", start_date_local: "2026-11-12T07:00:00", moving_time: 1800 },
    { id: 2, type: "WeightTraining", start_date_local: "2026-11-13T07:00:00", moving_time: 1800 }, // planned lift was skipped
    { id: 3, type: "Ride", start_date_local: "2026-11-12T08:00:00" },
  ]);
  const m = matchLifts(planned, lifts);

  it("only reads WeightTraining", () => expect(lifts.map((l) => l.id)).toEqual(["1", "2"]));
  it("matches a lift to the planned lift that day and leaves the rest unassigned", () => {
    expect(m.matched.get("1")).toEqual({ sessionId: "l", lift: "lower" });
    expect(m.unassigned.map((l) => l.id)).toEqual(["2"]);
  });
  it("counts per type against a clamped 0-7 target", () => {
    const c = liftCounts(m, { upper: 0, lower: 9 });
    expect(c.upper).toEqual({ actual: 0, target: 0, hit: true });
    expect(c.lower).toEqual({ actual: 1, target: 7, hit: false });
  });
});

describe("sessionStatus", () => {
  const logged = { rideDates: new Set(["2026-11-10"]), liftDates: new Set<string>() };
  const at = (iso: string) => new Date(iso);

  it("is done when something of the right sport is logged", () => {
    expect(sessionStatus(s("a", "2026-11-10", "vo2"), logged, at("2026-11-11T18:00:00Z"))).toBe("done");
    // A ride on the day doesn't count as a lift.
    expect(sessionStatus(s("a", "2026-11-10", "lift_upper"), logged, at("2026-11-11T18:00:00Z"))).toBe("not_logged");
  });
  it("marks a past day with nothing logged not_logged", () => {
    expect(sessionStatus(s("a", "2026-11-09", "lift_upper"), logged, at("2026-11-10T18:00:00Z"))).toBe("not_logged");
  });
  it("flips today to not_logged only from 21:00 Denver", () => {
    const e = s("a", "2026-11-10", "endurance");
    const none = { rideDates: new Set<string>(), liftDates: new Set<string>() };
    expect(sessionStatus(e, none, at("2026-11-11T03:30:00Z"))).toBe("planned"); // 8:30 pm MST
    expect(sessionStatus(e, none, at("2026-11-11T04:30:00Z"))).toBe("not_logged"); // 9:30 pm MST
  });
  it("keeps the future planned and a skip skipped", () => {
    expect(sessionStatus(s("a", "2026-11-12", "vo2"), logged, at("2026-11-10T18:00:00Z"))).toBe("planned");
    expect(sessionStatus(s("a", "2026-11-09", "vo2", "skipped"), logged, at("2026-11-12T18:00:00Z"))).toBe("skipped");
  });
});
