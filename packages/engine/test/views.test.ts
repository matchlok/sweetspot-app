import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { goalPreview, goalView, homeView, programView, sessionOptionsView, weekView } from "../src/views";
import { v4Scenario as D } from "./fixtures/scenario";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

/** Each view is checked against its committed fixture. Regenerate with UPDATE_FIXTURES=1 and review the diff. */
function fixture(name: string, actual: unknown) {
  const file = join(dir, `${name}.json`);
  if (process.env.UPDATE_FIXTURES || !existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(json(actual), null, 2) + "\n");
  }
  expect(json(actual)).toEqual(JSON.parse(readFileSync(file, "utf8")));
}

describe("v4 scenario: fixtures", () => {
  it("home", () => fixture("home", homeView(D)));
  it("week", () => fixture("week", weekView(D)));
  it("program", () => fixture("program", programView(D)));
  it("goal sweetSpot", () => fixture("goal-sweetSpot", goalView(D, "sweetSpot")));
  it("options: move VO2", () => fixture("options-move-vo2", sessionOptionsView(D, "w2-vo2", "move")));
  it("options: move the unlogged lift", () => fixture("options-move-upper", sessionOptionsView(D, "w2-upper", "move")));
});

describe("v4 scenario: the story the screens share", () => {
  const home = homeView(D);
  it("is week 2, today is VO2", () => {
    expect(home.weekLabel).toBe("week 2 of the program");
    expect(home.today?.kind).toBe("vo2");
    expect(home.isRecoveryWeek).toBe(false);
  });
  it("tracks endurance, sweet spot and VO2 every week, stepped up after week 1's hits", () => {
    expect(home.goals.find((g) => g.key === "vo2")).toMatchObject({ actual: 0, target: 9, hit: false });
    expect(home.goals.find((g) => g.key === "sweetSpot")).toMatchObject({ actual: 0, target: 21, hit: false });
    expect(home.goals.find((g) => g.key === "endurance")).toMatchObject({ actual: 0, target: 90 });
    expect(home.offGoals).toEqual([]);
  });
  it("nudges the unlogged Monday lift", () => {
    const s = home.strength!;
    expect(s).toMatchObject({ actual: 0, target: 2, hit: false, upper: { actual: 0, target: 1 }, lower: { actual: 0, target: 1 } });
    expect(s.nudge?.sessionId).toBe("w2-upper");
    expect(s.nudge?.text.startsWith("Still open from Monday.")).toBe(true);
  });
  it("reads fatigue from wellness and shows a green readiness pill", () => {
    expect(home.fatigue).toEqual({ form: -5, ramp: 3.2, load: null, note: null });
    expect(home.readiness).toMatchObject({ light: "green", label: "Ready" });
  });
  it("week view marks Monday not logged and notes next week", () => {
    const w = weekView(D);
    expect(w.label).toBe("Nov 9 to 15");
    expect(w.days[0]!.sessions[0]!.status).toBe("not_logged");
    expect(w.days[1]!.isToday).toBe(true);
    expect(w.nextWeekNote).toBeNull();
  });
  it("program shows sweet spot at 21 and the recovery streak", () => {
    const p = programView(D);
    expect(p.goals.find((g) => g.key === "sweetSpot")).toMatchObject({ mode: "progress", target: 21, stepMin: 1 });
    expect(p.goals.find((g) => g.key === "threshold")!.mode).toBe("off");
    expect(p.recovery).toMatchObject({ streak: 1, after: 3 });
  });
});

describe("state changes flow through", () => {
  it("a manual mark counts the lift and clears the nudge", () => {
    const data = { ...D, manualDone: [{ sessionId: "w2-upper" }] };
    const s = homeView(data).strength!;
    expect(s).toMatchObject({ actual: 1, upper: { actual: 1, target: 1 } });
    expect(s.nudge?.sessionId).not.toBe("w2-upper");
    expect(weekView(data).days[0]!.sessions[0]).toMatchObject({ status: "done", doneSource: "manual" });
  });
  it("a recorded lift matches the planned lift that day", () => {
    const home = homeView({ ...D, lifts: [{ id: "l1", date: "2026-11-09", movingSeconds: 2400 }] });
    expect(home.strength).toMatchObject({ actual: 1, upper: { actual: 1 }, untagged: 0 });
    expect(home.strength!.lifts[0]).toMatchObject({ tag: "upper", tagSource: "plan" });
  });
  it("one Strength bar replaces the two lift bars and sums their targets", () => {
    const home = homeView({ ...D, liftTargets: { upper: 3, lower: 0 } });
    expect(home.goals.some((g) => g.key === "upper" || g.key === "lower")).toBe(false);
    expect(home.strength).toMatchObject({ target: 3, upper: { target: 3 }, lower: { target: 0 } });
  });
  it("both lift targets at 0 hide the bar", () => {
    expect(homeView({ ...D, liftTargets: { upper: 0, lower: 0 } }).strength).toBeNull();
  });
  it("a VO2 ride shows in the bar and marks today done", () => {
    const rides = [
      ...D.rides,
      { id: "r3", date: "2026-11-10", movingSeconds: 3600, category: "unknown" as const, categorySource: null, power: [300, 1200, 0, 0, 540, 0, 0] },
    ];
    const home = homeView({ ...D, rides });
    expect(home.goals.find((g) => g.key === "vo2")).toMatchObject({ actual: 9, hit: true });
    expect(home.today).toMatchObject({ status: "done", doneSource: "intervals" });
  });
  it("an unknown session throws", () => {
    expect(() => sessionOptionsView(D, "nope", "move")).toThrow(/unknown session/);
  });
});

describe("goal preview", () => {
  it("lists planned sweet-spot weeks, starting with this week's Sunday session at 21", () => {
    const p = goalView(D, "sweetSpot").preview;
    expect(p[0]).toEqual({ date: "2026-11-15", target: 21, isRecovery: false });
    expect(p[1]).toEqual({ date: "2026-11-17", target: 22, isRecovery: false });
    expect(p.length).toBeGreaterThan(1);
  });
  it("redraws for a draft without saving", () => {
    const p = goalPreview(D, "sweetSpot", { mode: "progress", target: 30, stepMin: 4 });
    expect(p[0]!.target).toBe(30);
    // Week 3 is the third hit week in a row, so week 4 is a recovery week at 60% of the stepped-up 38.
    expect(p[1]).toMatchObject({ target: 34, isRecovery: false });
    expect(p[2]).toMatchObject({ target: 23, isRecovery: true });
  });
  it("hold stays flat and off is empty", () => {
    const hold = goalPreview(D, "sweetSpot", { mode: "hold", target: 25, stepMin: 0 });
    expect(new Set(hold.filter((x) => !x.isRecovery).map((x) => x.target))).toEqual(new Set([25]));
    expect(hold.filter((x) => x.isRecovery).every((x) => x.target === 15)).toBe(true);
    expect(goalPreview(D, "sweetSpot", { mode: "off", target: 25, stepMin: 0 })).toEqual([]);
  });
});

describe("month view", () => {
  it("covers the month in Monday-start weeks with the plan's sessions", async () => {
    const { monthView } = await import("../src/views");
    const m = monthView(D);
    expect(m).toMatchObject({ month: "2026-11", label: "November 2026", start: "2026-10-26" });
    expect(m.weeks.map((w) => w.start)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    const nov10 = m.weeks[2]!.days[1]!;
    expect(nov10).toMatchObject({ date: "2026-11-10", isToday: true, inMonth: true });
    expect(nov10.sessions.map((s) => s.kind)).toEqual(["vo2"]);
    // The last row spills into December and has no plan data yet.
    const tail = m.weeks[5]!.days;
    expect(tail[0]!.inMonth).toBe(true); // Nov 30
    expect(tail[1]!.inMonth).toBe(false);
    expect(tail.every((x) => x.sessions.length === 0)).toBe(true);
  });
  it("starts a month that opens midweek on that week's Monday", async () => {
    const { monthView } = await import("../src/views");
    const m = monthView(D, "2026-10-15");
    expect(m.start).toBe("2026-09-28");
    expect(m.weeks[0]!.days.slice(0, 3).every((x) => !x.inMonth)).toBe(true);
  });
});
