import { describe, expect, it } from "vitest";
import { addDays } from "../src/dates";
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

  it("reads the origin from the app's tag when Google gives none (a single event, not a series)", () => {
    const tagged = events.map((e) =>
      e.id === "w2-ss" ? { ...e, originalStartTime: undefined, extendedProperties: { private: { sweetspotOrigin: "2026-11-15" } } } : e,
    );
    expect(readWeek(tagged, "2026-11-09").sessions).toEqual([
      expect.objectContaining({ id: "w2-ss~origin", date: "2026-11-15", status: "skipped", movedTo: "2026-11-18" }),
    ]);
    expect(readWeek(tagged, "2026-11-16").sessions.map((s) => s.id)).toEqual(["w2-ss", "w3-vo2"]);
  });

  it("ignores a malformed origin tag", () => {
    const bad = [ev("a", "2026-11-12", "VO2 Max Intervals (~1 hr)", { extendedProperties: { private: { sweetspotOrigin: "last week" } } })];
    expect(readWeek(bad, "2026-11-09").sessions[0]!.origin).toBeUndefined();
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
  });

  it("offers next week's days even when next week has no plan or events", () => {
    const empty = sessionOptionsView({ ...D, plans: D.plans.filter((p) => p.weekStart !== "2026-11-16") }, "w2-ss", "move");
    const next = empty.options.filter((o) => o.heading.endsWith("next week"));
    expect(next.map((o) => o.id)).toEqual(["move:2026-11-16", "move:2026-11-17", "move:2026-11-18", "move:2026-11-19", "move:2026-11-20", "move:2026-11-21", "move:2026-11-22"]);
    expect(next.every((o) => !o.absorbs)).toBe(true);
  });

  it("a skipped session whose week is over gets exactly what a planned one gets", () => {
    const late = { ...D, today: "2026-11-17", now: new Date("2026-11-17T14:30:00Z") };
    const skipAt = (kind: string) => ({
      ...late,
      plans: late.plans.map((p) => ({ ...p, sessions: p.sessions.map((s) => (s.kind === kind && p.weekStart === "2026-11-09" ? { ...s, status: "skipped" as const } : s)) })),
    });
    for (const [id, kind] of [["w2-ss", "sweet_spot"], ["w2-lower", "lift_lower"]] as const) {
      const planned = sessionOptionsView(late, id, "move");
      const skipped = sessionOptionsView(skipAt(kind), id, "move");
      expect(skipped.session.status).toBe("not_logged");
      expect(skipped.session.statusLabel).toBe("Missed");
      const ids = (o: typeof planned) => o.options.map((x) => x.id);
      expect(ids(skipped).length, id).toBeGreaterThan(0);
      expect(ids(skipped).every((i) => i >= "move:2026-11-16"), id).toBe(true);
      expect(ids(skipped), id).toEqual(ids(planned));
    }
  });

  it("a skipped session still can't double a day: the one-ride rule applies", () => {
    const late = { ...D, today: "2026-11-17", now: new Date("2026-11-17T14:30:00Z") };
    const data = { ...late, plans: late.plans.map((p) => ({ ...p, sessions: p.sessions.map((s) => (s.id === "w2-ss" ? { ...s, status: "skipped" as const } : s)) })) };
    const o = sessionOptionsView(data, "w2-ss", "move");
    expect(o.options.some((x) => x.id === "move:2026-11-19")).toBe(false); // next week's VO2 is there
    expect(o.blocked.some((b) => b.reason === "Already a ride that day")).toBe(true);
  });

  it("is offered for every kind, including a session that is already not logged", () => {
    // w2-upper (Mon Nov 9) is not logged; w2-ss and w2-vo2 are planned. Each gets days in next week.
    for (const [id, kind] of [["w2-ss", "sweet_spot"], ["w2-vo2", "vo2"], ["w2-upper", "lift_upper"]] as const) {
      const o = sessionOptionsView(D, id, "move");
      expect(o.session.kind).toBe(kind);
      const next = o.options.filter((x) => x.heading.endsWith("next week"));
      expect(next.length, id).toBeGreaterThan(0);
      // At least 7 days ahead of the session's own day is reachable across the boundary.
      expect(next.some((x) => x.id.slice(5) >= addDays(o.session.date, 7)), id).toBe(true);
    }
  });

  it("a not-logged session is already a miss, so moving it doesn't say it counts as missed", () => {
    const late = sessionOptionsView(D, "w2-upper", "move");
    const o = late.options.find((x) => x.id === "move:2026-11-17")!;
    expect(o.effects.map((e) => e.text)).not.toEqual(expect.arrayContaining([expect.stringContaining("counts as missed")]));
    expect(late.canMarkDone).toBe(true);
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
