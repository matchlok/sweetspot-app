import { describe, expect, it } from "vitest";
import { readWeek, type CalendarEvent } from "../src/calendar";
import type { RideZones } from "../src/intervals";
import { DEFAULT_PROGRAM } from "../src/targets";
import { homeView, sessionOptionsView, weekView, type ViewData } from "../src/views";

/**
 * SWE-41. Fake calendar events and rides only. Week of Mon Nov 16 2026: sweet spot
 * Tuesday, VO2 Thursday, long ride Saturday. All dates America/Denver.
 */
const ev = (id: string, date: string, summary: string): CalendarEvent => ({ id, summary, status: "confirmed", start: { date } });

const events: CalendarEvent[] = [
  ev("ss", "2026-11-17", "Sweet Spot Intervals (~1 hr)"),
  ev("vo2", "2026-11-19", "VO2 Max Intervals (~1 hr)"),
  ev("long", "2026-11-21", "Endurance Ride (1.5 hrs)"),
];

/** 50 minutes with 21 of them at 88 to 94% FTP: the "21/20" ride. */
const fridayRide: RideZones = {
  id: "fri",
  date: "2026-11-20",
  movingSeconds: 3000,
  category: "sweet_spot",
  categorySource: "power",
  power: [600, 0, 1140, 1260, 0, 0, 0],
  sweetSpotSeconds: 1260,
};

const data = (over: Partial<ViewData>): ViewData => ({
  today: "2026-11-20",
  program: DEFAULT_PROGRAM,
  plans: [readWeek(events, "2026-11-16")],
  rides: [fridayRide],
  lifts: [],
  lastSyncedAt: "2026-11-20T12:00:00-07:00",
  ...over,
});

const find = (v: ReturnType<typeof weekView>, id: string) => v.days.flatMap((d) => d.sessions.map((s) => ({ ...s, day: d.date }))).find((s) => s.id === id)!;

describe("a ride logged after its planned day", () => {
  it("counts the minutes (the 21) and marks the Tuesday session done on Friday", () => {
    const d = data({});
    const home = homeView(d);
    expect(home.goals.find((g) => g.key === "sweetSpot")?.actual).toBe(21);
    const w = weekView(d);
    expect(find(w, "ss")).toMatchObject({
      day: "2026-11-20",
      date: "2026-11-20",
      status: "done",
      matchedRide: { activityId: "fri", detected: "sweet_spot", substituted: false },
      shifted: { from: "2026-11-17", reason: "ride" },
    });
    // Nothing is left on Tuesday.
    expect(w.days.find((x) => x.date === "2026-11-17")!.sessions).toEqual([]);
  });

  it("re-places the missed VO2 into Sunday through the rule gate (Saturday has the long ride)", () => {
    const w = weekView(data({}));
    expect(find(w, "vo2")).toMatchObject({ day: "2026-11-22", status: "planned", shifted: { from: "2026-11-19", reason: "reshuffle" } });
    expect(w.scheduleGap).toBeNull();
    expect(homeView(data({})).scheduleGap).toBeNull();
  });

  it("a done session never moves, and the day sheet agrees with the week", () => {
    const v = sessionOptionsView(data({}), "ss", "move");
    expect(v.session).toMatchObject({ date: "2026-11-20", status: "done" });
    expect(v.options).toEqual([]);
  });

  it("does not match a ride to a session planned later than the ride", () => {
    const w = weekView(data({ rides: [{ ...fridayRide, date: "2026-11-17" }], today: "2026-11-17" }));
    // Tuesday's own ride matches Tuesday's session as before; no shift.
    expect(find(w, "ss").shifted).toBeUndefined();
    expect(find(w, "vo2").status).toBe("planned");
  });

  it("an endurance plan does not take the sweet spot ride a sweet spot plan is waiting for", () => {
    const e = [...events, ev("end", "2026-11-18", "Endurance Ride (1 hr)")];
    const w = weekView(data({ plans: [readWeek(e, "2026-11-16")] }));
    expect(find(w, "ss")).toMatchObject({ status: "done", shifted: { reason: "ride" } });
    expect(find(w, "end").status).not.toBe("done");
  });
});

describe("leftovers that do not fit", () => {
  // Saturday with the long ride still to do; sweet spot (Tue) and VO2 (Wed) missed, no rides.
  const e = [ev("ss", "2026-11-17", "Sweet Spot Intervals (~1 hr)"), ev("vo2", "2026-11-18", "VO2 Max Intervals (~1 hr)"), ev("long", "2026-11-21", "Endurance Ride (1.5 hrs)")];
  const d = data({ today: "2026-11-21", rides: [], plans: [readWeek(e, "2026-11-16")] });

  it("places the earliest one on Sunday and prompts for the other on Week and Home", () => {
    const w = weekView(d);
    expect(find(w, "ss")).toMatchObject({ day: "2026-11-22", status: "planned", shifted: { reason: "reshuffle" } });
    expect(find(w, "vo2")).toMatchObject({ day: "2026-11-18", status: "not_logged" });
    expect(w.scheduleGap).toEqual({ text: expect.stringContaining("Fill in the schedule"), sessionIds: ["vo2"] });
    expect(homeView(d).scheduleGap).toEqual(w.scheduleGap);
  });

  it("quality gets the only free slot even when an endurance ride was missed earlier", () => {
    const q = [ev("end", "2026-11-16", "Endurance Ride (1 hr)"), ev("vo2", "2026-11-18", "VO2 Max Intervals (~1 hr)"), ev("long", "2026-11-21", "Endurance Ride (1.5 hrs)")];
    const w = weekView(data({ today: "2026-11-21", rides: [], plans: [readWeek(q, "2026-11-16")] }));
    expect(find(w, "vo2")).toMatchObject({ day: "2026-11-22", status: "planned", shifted: { reason: "reshuffle" } });
    expect(find(w, "end")).toMatchObject({ day: "2026-11-16", status: "not_logged" });
    expect(w.scheduleGap?.sessionIds).toEqual(["end"]);
  });

  it("shows no prompt in a week other than the one holding today", () => {
    expect(weekView(d, "2026-11-09").scheduleGap).toBeNull();
  });
});
