import { describe, expect, it } from "vitest";
import { readWeek, type CalendarEvent } from "../src/calendar";
import type { Category } from "../src/categorize";
import type { RideZones } from "../src/intervals";
import { rideMatch, matchRides } from "../src/match";
import { weekView, type ViewData } from "../src/views";
import { DEFAULT_PROGRAM } from "../src/targets";
import { weeklyZoneRows } from "../src/scorecard";
import { toActivityZones } from "../src/intervals";

/** Ports the cases in `_ride_match()` (reference/muse/strava_tracker.py), one test per rule. */
const ride = (id: string, category: Category, minutes = 60, date = "2026-11-10"): RideZones => ({
  id,
  date,
  movingSeconds: minutes * 60,
  category,
  categorySource: category === "unknown" ? null : "power",
});

describe("rideMatch", () => {
  it("an exact category match wins", () => {
    const r = rideMatch("sweet_spot", [ride("e", "endurance"), ride("v", "vo2"), ride("s", "sweet_spot")]);
    expect(r).toMatchObject({ detected: "sweet_spot", substituted: false });
    expect(r.ride?.id).toBe("s");
  });

  it("a vo2 ride satisfies a sweet spot plan and records the substitution", () => {
    const r = rideMatch("sweet_spot", [ride("v", "vo2")]);
    expect(r.ride?.id).toBe("v");
    expect(r).toMatchObject({ detected: "vo2", substituted: true });
  });

  it("a sweet spot ride satisfies a vo2 plan and records the substitution", () => {
    const r = rideMatch("vo2", [ride("s", "sweet_spot")]);
    expect(r.ride?.id).toBe("s");
    expect(r).toMatchObject({ detected: "sweet_spot", substituted: true });
  });

  it("an endurance plan accepts any categorized ride", () => {
    expect(rideMatch("endurance", [ride("s", "sweet_spot")]).ride?.id).toBe("s");
    expect(rideMatch("endurance", [ride("v", "vo2")]).ride?.id).toBe("v");
    expect(rideMatch("endurance", [ride("e", "endurance")]).ride?.id).toBe("e");
  });

  it("a quality plan with only an endurance ride is a miss, and the ride is recorded as detected", () => {
    const r = rideMatch("vo2", [ride("e", "endurance")]);
    expect(r.ride).toBeNull();
    expect(r.detected).toBe("endurance");
    expect(rideMatch("sweet_spot", [ride("e", "endurance")]).ride).toBeNull();
  });

  it("a ride with no zone data counts toward endurance from 30 minutes", () => {
    expect(rideMatch("endurance", [ride("u", "unknown", 30)]).ride?.id).toBe("u");
    const short = rideMatch("endurance", [ride("u", "unknown", 29)]);
    expect(short.ride).toBeNull();
    expect(short.detected).toBe("unknown");
  });

  it("a ride with no zone data does not satisfy a quality plan", () => {
    const r = rideMatch("vo2", [ride("u", "unknown", 90)]);
    expect(r.ride).toBeNull();
    expect(r.detected).toBe("unknown");
  });

  it("an easy spin accepts any ride at all", () => {
    expect(rideMatch("easy_spin", [ride("u", "unknown", 10)]).ride?.id).toBe("u");
    expect(rideMatch("easy_spin", [ride("v", "vo2")]).ride?.id).toBe("v");
  });

  it("no rides is no match and nothing detected", () => {
    expect(rideMatch("endurance", [])).toEqual({ ride: null, detected: null, substituted: false });
  });
});

// ---- Through readWeek ----

const ev = (id: string, date: string, summary: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  summary,
  status: "confirmed",
  start: { date },
  ...extra,
});

describe("matchRides on readWeek sessions", () => {
  it("a skipped session stays a miss even with a matching ride that day", () => {
    const week = readWeek([ev("a", "2026-11-10", "VO2 Max Intervals (~1 hr)", { status: "cancelled" })], "2026-11-09");
    const m = matchRides(week.sessions, [ride("v", "vo2")]);
    expect(m.size).toBe(0);
  });

  it("a session moved out of the week is not matched on its original day", () => {
    const events = [ev("a", "2026-11-17", "VO2 Max Intervals (~1 hr)", { originalStartTime: { date: "2026-11-10" } })];
    const week = readWeek(events, "2026-11-09");
    expect(matchRides(week.sessions, [ride("v", "vo2")]).size).toBe(0);
  });

  it("a session moved in from last week matches on its new date", () => {
    const events = [ev("a", "2026-11-10", "VO2 Max Intervals (~1 hr)", { originalStartTime: { date: "2026-11-03" } })];
    const week = readWeek(events, "2026-11-09");
    expect(matchRides(week.sessions, [ride("v", "vo2")]).get("a")?.ride?.id).toBe("v");
  });

  it("one ride satisfies one session", () => {
    const week = readWeek([ev("a", "2026-11-10", "Endurance Ride (1 hr)"), ev("b", "2026-11-10", "Sweet Spot (1 hr)")], "2026-11-09");
    const m = matchRides(week.sessions, [ride("s", "sweet_spot")]);
    expect([...m.values()].filter((x) => x.ride).length).toBe(1);
  });

  it("lifts are not ride-matched", () => {
    const week = readWeek([ev("l", "2026-11-10", "Lift A — Lower Body")], "2026-11-09");
    expect(matchRides(week.sessions, [ride("e", "endurance")]).size).toBe(0);
  });
});

describe("views use the match", () => {
  const events = [
    ev("ss", "2026-11-10", "Sweet Spot Intervals (~1 hr)"),
    ev("vo2", "2026-11-11", "VO2 Max Intervals (~1 hr)"),
    ev("end", "2026-11-14", "Endurance Ride (1.5 hrs)"),
  ];
  const base = (rides: RideZones[]): ViewData => ({
    today: "2026-11-16",
    now: new Date("2026-11-16T14:30:00Z"),
    program: DEFAULT_PROGRAM,
    plans: [readWeek(events, "2026-11-09")],
    rides,
    lifts: [],
    lastSyncedAt: "2026-11-16T06:00:00-07:00",
  });
  const sessions = (rides: RideZones[]) => weekView(base(rides), "2026-11-09").days.flatMap((d) => d.sessions);

  it("records the substitution when a vo2 ride covers sweet spot", () => {
    const s = sessions([ride("v", "vo2", 60, "2026-11-10")]).find((x) => x.id === "ss")!;
    expect(s.status).toBe("done");
    expect(s.matchedRide).toEqual({ activityId: "v", detected: "vo2", substituted: true });
  });

  it("an endurance-category ride leaves a quality session not logged", () => {
    const s = sessions([ride("e", "endurance", 60, "2026-11-10")]).find((x) => x.id === "ss")!;
    expect(s.status).toBe("not_logged");
    expect(s.matchedRide).toBeUndefined();
  });

  it("an unzoned ride of 30 minutes or more covers endurance, so a data gap is not a miss", () => {
    const s = sessions([ride("u", "unknown", 45, "2026-11-14")]).find((x) => x.id === "end")!;
    expect(s.status).toBe("done");
  });

  it("off-plan rides still count in the weekly zone minutes", () => {
    // Tuesday's ride is not an endurance-category match for the VO2 plan on Wednesday; it still counts in zone minutes.
    const offPlan: RideZones = { ...ride("x", "endurance", 60, "2026-11-13"), power: [0, 3600, 0, 0, 0, 0, 0] };
    expect(sessions([offPlan]).every((s) => s.status !== "done")).toBe(true);
    const week = weeklyZoneRows(toActivityZones([offPlan]), "2026-11-13", 1)[0]!;
    expect(week.enduranceSeconds).toBe(3600);
  });
});
