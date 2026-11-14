import { describe, expect, it } from "vitest";
import { dayOptions, type WeekSession } from "../src/options";

const S = (id: string, date: string, kind: WeekSession["kind"], status: WeekSession["status"] = "planned"): WeekSession => ({
  id, date, kind, title: id, minutes: null, status,
});

// v4 scenario: Tuesday Nov 10, Monday's lift not logged.
const v4 = [
  S("liftB", "2026-11-09", "lift_upper", "not_logged"),
  S("vo2", "2026-11-10", "vo2"),
  S("liftA", "2026-11-12", "lift_lower"),
  S("long", "2026-11-14", "endurance"),
];
const TODAY = "2026-11-10";

describe("move", () => {
  const o = dayOptions({ sessions: v4, sessionId: "vo2", action: "move", today: TODAY });
  const ids = o.options.map((x) => x.id);

  it("offers only today and later in the week, never the past", () => {
    expect(ids.every((id) => id.slice(5) >= TODAY)).toBe(true);
    expect(ids).not.toContain("move:2026-11-09");
  });
  it("pulls the lower lift out of the way when VO2 moves to Friday", () => {
    const fri = o.options.find((x) => x.id === "move:2026-11-13")!;
    expect(fri.alsoMoves).toEqual([{ sessionId: "liftA", to: "2026-11-11" }]); // Wednesday
    expect(fri.cta).toBe("Move to Friday, lower to Wednesday");
  });
  it("allows Wednesday with no knock-on, since the lift stays after it", () => {
    const wed = o.options.find((x) => x.id === "move:2026-11-11")!;
    expect(wed.alsoMoves).toEqual([]);
  });
  it("warns when VO2 shares a day with a lift", () => {
    const thu = o.options.find((x) => x.id === "move:2026-11-12")!;
    expect(thu.effects.some((e) => e.tone === "warn")).toBe(true);
    expect(thu.rules.find((r) => r.rule === "lift_with_quality")!.result).toBe("warn");
  });
  it("blocks a day that already has a ride", () => {
    expect(o.blocked).toContainEqual({ heading: "Saturday, Nov 14", reason: "Already a ride that day" });
  });
  it("keeps the plan version stable and sensitive to changes", () => {
    const again = dayOptions({ sessions: [...v4].reverse(), sessionId: "vo2", action: "move", today: TODAY });
    expect(again.planVersion).toBe(o.planVersion);
    const moved = dayOptions({ sessions: v4.map((s) => (s.id === "vo2" ? { ...s, date: "2026-11-11" } : s)), sessionId: "vo2", action: "move", today: TODAY });
    expect(moved.planVersion).not.toBe(o.planVersion);
  });
});

describe("not_logged lift", () => {
  const o = dayOptions({ sessions: v4, sessionId: "liftB", action: "move", today: TODAY });
  it("can be marked done and only moves forward in the week", () => {
    expect(o.canMarkDone).toBe(true);
    expect(o.options.map((x) => x.id)).not.toContain("move:2026-11-09");
    expect(o.options.length).toBeGreaterThan(0);
  });
});

describe("completed sessions", () => {
  it("don't move", () => {
    const sessions = v4.map((s) => (s.id === "liftB" ? { ...s, status: "done" as const } : s));
    const o = dayOptions({ sessions, sessionId: "liftB", action: "move", today: TODAY });
    expect(o.options).toEqual([]);
    expect(o.blocked[0]!.reason).toMatch(/Completed sessions don't move/);
  });
  it("can't be displaced by someone else's move", () => {
    const sessions = v4.map((s) => (s.id === "long" ? { ...s, status: "done" as const } : s));
    const o = dayOptions({ sessions, sessionId: "vo2", action: "swap", today: TODAY });
    expect(o.options.map((x) => x.id)).not.toContain("swap:long");
  });
});

describe("long ride", () => {
  it("keeps the weekend by default and can be overridden with a warning", () => {
    const week = [S("long", "2026-11-14", "endurance")];
    const strict = dayOptions({ sessions: week, sessionId: "long", action: "move", today: TODAY });
    expect(strict.options.map((x) => x.id)).toEqual(["move:2026-11-15"]);
    expect(strict.blocked.map((b) => b.reason)).toContain("The long ride keeps the weekend");

    const loose = dayOptions({ sessions: week, sessionId: "long", action: "move", today: TODAY, allowLongRideOffWeekend: true });
    const fri = loose.options.find((x) => x.id === "move:2026-11-13")!;
    expect(fri.effects).toContainEqual({ text: "Long ride leaves the weekend.", tone: "warn" });
  });
});

describe("swap and skip", () => {
  it("swaps two sessions and blocks a swap that puts a lower lift before quality", () => {
    // Swapping VO2 (Tue) with the lower lift (Thu) puts the lift on Tue and VO2 on Thu: fine.
    const o = dayOptions({ sessions: v4, sessionId: "vo2", action: "swap", today: TODAY });
    const withLift = o.options.find((x) => x.id === "swap:liftA")!;
    expect(withLift.alsoMoves).toEqual([{ sessionId: "liftA", to: "2026-11-10" }]);
    // Swapping VO2 with the long ride: VO2 on Sat, endurance Tue: long ride off the weekend.
    expect(o.blocked.some((b) => b.heading.startsWith("Saturday") && /weekend/.test(b.reason))).toBe(true);
  });
  it("counts a skip as a miss, except an optional spin", () => {
    const skip = dayOptions({ sessions: v4, sessionId: "vo2", action: "skip", today: TODAY });
    expect(skip.options[0]!.effects[0]).toEqual({ text: "VO2 intervals counts as missed this week.", tone: "warn" });
    const spin = dayOptions({ sessions: [S("spin", "2026-10-27", "easy_spin")], sessionId: "spin", action: "skip", today: "2026-10-27" });
    expect(spin.options[0]!.effects[0]!.tone).toBe("plain");
  });
});

describe("Muse Week 4 (Oct 26 to Nov 1, recovery week)", () => {
  const week4 = [
    S("liftB", "2026-10-26", "lift_upper", "done"),
    S("spin", "2026-10-27", "easy_spin"),
    S("liftA", "2026-10-29", "lift_lower"),
    S("long", "2026-10-31", "endurance"),
  ];
  it("lets Lift A move Thursday to Friday", () => {
    const o = dayOptions({ sessions: week4, sessionId: "liftA", action: "move", today: "2026-10-29" });
    expect(o.options.map((x) => x.id)).toContain("move:2026-10-30");
  });
  it("moves the Saturday endurance ride to Sunday when out of town, and nowhere else", () => {
    const o = dayOptions({ sessions: week4, sessionId: "long", action: "move", today: "2026-10-31" });
    expect(o.options.map((x) => x.id)).toEqual(["move:2026-11-01"]);
  });
});
