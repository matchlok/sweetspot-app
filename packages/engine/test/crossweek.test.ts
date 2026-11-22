import { describe, expect, it } from "vitest";
import { readWeek, type CalendarEvent } from "../src/calendar";
import { homeView, sessionOptionsView, weekView } from "../src/views";
import { v4Scenario as D } from "./fixtures/scenario";

const ev = (id: string, date: string, summary: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  summary,
  status: "confirmed",
  start: { date },
  ...extra,
});

describe("moves across weeks (rule 4, 2026-11-20)", () => {
  // Week 2's sweet spot (Sun Nov 15) moved to Wednesday Nov 18; week 3 has its own on Tuesday.
  const events = [
    ev("w2-ss", "2026-11-18", "Sweet Spot Intervals (~1 hr)", { originalStartTime: { date: "2026-11-15" } }),
    ev("w3-ss", "2026-11-17", "Sweet Spot Intervals (~1 hr)"),
    ev("w3-vo2", "2026-11-19", "VO2 Max Intervals (~1 hr)"),
  ];

  it("leaves a skipped stand-in on the original day of the origin week", () => {
    const w2 = readWeek(events, "2026-11-09");
    expect(w2.sessions).toEqual([
      expect.objectContaining({ id: "w2-ss~origin", date: "2026-11-15", status: "skipped", movedTo: "2026-11-18" }),
    ]);
  });

  it("on the same day nothing is replaced: both events stay", () => {
    const same = events.map((e) => (e.id === "w2-ss" ? { ...e, start: { date: "2026-11-17" } } : e));
    const w3 = readWeek(same, "2026-11-16");
    expect(w3.sessions.map((s) => s.id)).toEqual(["w2-ss", "w3-ss", "w3-vo2"]);
    expect(w3.sessions.filter((s) => s.kind === "sweet_spot").every((s) => s.date === "2026-11-17")).toBe(true);
  });

  it("the destination week keeps one sweet spot: the moved one replaces its own", () => {
    const w3 = readWeek(events, "2026-11-16");
    expect(w3.sessions.map((s) => s.id)).toEqual(["w2-ss", "w3-vo2"]);
    expect(w3.sessions[0]).toMatchObject({ movedFrom: "2026-11-15", status: "planned" });
  });

  it("drops a replaced session even when the calendar already cancelled it", () => {
    const cancelled = events.map((e) => (e.id === "w3-ss" ? { ...e, status: "cancelled" as const } : e));
    expect(readWeek(cancelled, "2026-11-16").sessions.map((s) => s.id)).toEqual(["w2-ss", "w3-vo2"]);
  });

  it("a move inside the same week is not a cross-week move", () => {
    const e = [ev("a", "2026-11-12", "VO2 Max Intervals (~1 hr)", { originalStartTime: { date: "2026-11-10" } })];
    const w = readWeek(e, "2026-11-09");
    expect(w.sessions).toHaveLength(1);
    expect(w.sessions[0]!.movedFrom).toBeUndefined();
    expect(w.sessions[0]!.movedTo).toBeUndefined();
  });

  it("a cancelled instance is a skip with no movedTo", () => {
    const e = [ev("a", "2026-11-10", "VO2 Max Intervals (~1 hr)", { status: "cancelled" })];
    expect(readWeek(e, "2026-11-09").sessions[0]).toMatchObject({ status: "skipped" });
  });
});

describe("a skip is a miss", () => {
  it("keeps the goal judged in a week where its only session was skipped", () => {
    const plans = D.plans.map((p) =>
      p.weekStart === "2026-11-09" ? { ...p, sessions: p.sessions.map((s) => (s.id === "w2-ss" ? { ...s, status: "skipped" as const } : s)) } : p,
    );
    const home = homeView({ ...D, plans });
    expect(home.goals.find((g) => g.key === "sweetSpot")).toMatchObject({ target: 21, actual: 0, hit: false });
    expect(home.offGoals).toEqual([]);
  });

  it("a miss in week 2 repeats the target and resets the streak", () => {
    // Week 2 is complete by Nov 17: sweet spot skipped, so week 3 repeats 21 and the streak is 0.
    const plans = D.plans.map((p) =>
      p.weekStart === "2026-11-09" ? { ...p, sessions: p.sessions.map((s) => (s.id === "w2-ss" ? { ...s, status: "skipped" as const } : s)) } : p,
    );
    const home = homeView({ ...D, plans, today: "2026-11-17", now: new Date("2026-11-17T14:30:00Z") });
    expect(home.goals.find((g) => g.key === "sweetSpot")!.target).toBe(21);
  });
});

describe("option to move into next week", () => {
  const opts = sessionOptionsView(D, "w2-ss", "move");

  it("offers next week's days, counts this week as missed and replaces next week's session", () => {
    const o = opts.options.find((x) => x.id === "move:2026-11-18")!;
    expect(o).toBeDefined();
    expect(o.heading).toBe("Wednesday, Nov 18, next week");
    expect(o.effects.map((e) => e.text)).toEqual(
      expect.arrayContaining(["Sweet spot counts as missed this week.", "It replaces next week's sweet spot, so next week still has one."]),
    );
    expect(o.absorbs).toEqual([{ sessionId: "w3-ss" }]);
  });

  it("refuses the day of next week's same-kind session instead of replacing it", () => {
    // w3-ss is on Tuesday Nov 17: moving onto it would double the day.
    expect(opts.options.some((o) => o.id === "move:2026-11-17")).toBe(false);
    expect(opts.blocked).toEqual(
      expect.arrayContaining([expect.objectContaining({ heading: "Tuesday, Nov 17, next week", reason: "Already a ride that day" })]),
    );
  });

  it("applies the rule gate to next week's layout", () => {
    // Thursday Nov 19 already has next week's VO2: one ride a day.
    expect(opts.blocked).toEqual(expect.arrayContaining([expect.objectContaining({ heading: "Thursday, Nov 19, next week" })]));
    expect(opts.options.some((o) => o.id === "move:2026-11-19")).toBe(false);
  });

  it("includes next week in the plan version", () => {
    const without = sessionOptionsView({ ...D, plans: D.plans.filter((p) => p.weekStart !== "2026-11-16") }, "w2-ss", "move");
    expect(without.planVersion).not.toBe(opts.planVersion);
    expect(without.options.every((o) => !o.heading.endsWith("next week"))).toBe(true);
  });

  it("is not offered for a session that is already not logged", () => {
    const late = sessionOptionsView(D, "w2-upper", "move");
    expect(late.options.every((o) => !o.heading.endsWith("next week"))).toBe(true);
  });

  it("week view shows the stand-in and the moved session once the move is in the calendar", () => {
    const w2 = D.plans.find((p) => p.weekStart === "2026-11-09")!;
    const w3 = D.plans.find((p) => p.weekStart === "2026-11-16")!;
    const events = [
      ev("w2-ss", "2026-11-18", "Sweet Spot Intervals (~1 hr)", { originalStartTime: { date: "2026-11-15" } }),
      ev("w3-ss", "2026-11-17", "Sweet Spot Intervals (~1 hr)"),
    ];
    const plans = [
      { ...w2, sessions: [...w2.sessions.filter((s) => s.id !== "w2-ss"), ...readWeek(events, "2026-11-09").sessions] },
      { ...w3, sessions: [...w3.sessions.filter((s) => s.kind !== "sweet_spot"), ...readWeek(events, "2026-11-16").sessions] },
    ];
    const rest = D.plans.filter((p) => p.weekStart !== w2.weekStart && p.weekStart !== w3.weekStart);
    const data = { ...D, plans: [...rest, ...plans] };
    const wk2 = weekView(data, "2026-11-09");
    expect(wk2.days[6]!.sessions[0]).toMatchObject({ status: "skipped", movedTo: "2026-11-18" });
    const ss = weekView(data, "2026-11-16").days[2]!.sessions.filter((s) => s.kind === "sweet_spot");
    expect(ss).toHaveLength(1);
    expect(ss[0]).toMatchObject({ id: "w2-ss", movedFrom: "2026-11-15" });
  });
});
