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
  it("shows VO2 at 8 and endurance at 90, with no invented minutes", () => {
    expect(home.goals.find((g) => g.key === "vo2")).toMatchObject({ actual: 0, target: 8, hit: false });
    expect(home.goals.find((g) => g.key === "endurance")).toMatchObject({ actual: 0, target: 90 });
  });
  it("leaves sweet spot off this week, back Nov 17 at 22 min", () => {
    expect(home.goals.some((g) => g.key === "sweetSpot")).toBe(false);
    expect(home.offGoals).toEqual([{ key: "sweetSpot", label: "Sweet spot", text: "Not planned this week. Back Nov 17 at 22 min." }]);
  });
  it("nudges the unlogged Monday lift", () => {
    const upper = home.goals.find((g) => g.key === "upper")!;
    expect(upper).toMatchObject({ actual: 0, target: 1, hit: false });
    expect(upper.nudge?.sessionId).toBe("w2-upper");
    expect(upper.nudge?.text.startsWith("Still open from Monday.")).toBe(true);
  });
  it("reads fatigue from wellness and leaves load and readiness empty", () => {
    expect(home.fatigue).toEqual({ form: -5, ramp: 3.2, load: null, note: null });
    expect(home.readiness).toBeNull();
  });
  it("week view marks Monday not logged and notes next week", () => {
    const w = weekView(D);
    expect(w.label).toBe("Nov 9 to 15");
    expect(w.days[0]!.sessions[0]!.status).toBe("not_logged");
    expect(w.days[1]!.isToday).toBe(true);
    expect(w.nextWeekNote).toBe("Sweet spot returns Tuesday at 22 min. VO2 sits out.");
  });
  it("program shows sweet spot at 22 and the recovery streak", () => {
    const p = programView(D);
    expect(p.goals.find((g) => g.key === "sweetSpot")).toMatchObject({ mode: "progress", target: 22, stepMin: 2 });
    expect(p.goals.find((g) => g.key === "threshold")!.mode).toBe("off");
    expect(p.recovery).toMatchObject({ streak: 1, after: 3 });
  });
});

describe("state changes flow through", () => {
  it("a manual mark counts the lift and clears the nudge", () => {
    const data = { ...D, manualDone: [{ sessionId: "w2-upper" }] };
    const upper = homeView(data).goals.find((g) => g.key === "upper")!;
    expect(upper).toMatchObject({ actual: 1, hit: true });
    expect(upper.nudge).toBeUndefined();
    expect(weekView(data).days[0]!.sessions[0]).toMatchObject({ status: "done", doneSource: "manual" });
  });
  it("a recorded lift matches the planned lift that day", () => {
    const home = homeView({ ...D, lifts: [{ id: "l1", date: "2026-11-09", movingSeconds: 2400 }] });
    expect(home.goals.find((g) => g.key === "upper")).toMatchObject({ actual: 1, hit: true });
  });
  it("a lift target of 0 hides the bar", () => {
    const home = homeView({ ...D, liftTargets: { upper: 0, lower: 1 } });
    expect(home.goals.some((g) => g.key === "upper")).toBe(false);
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
  it("lists planned sweet-spot weeks starting Nov 17 at 22", () => {
    const p = goalView(D, "sweetSpot").preview;
    expect(p[0]).toEqual({ date: "2026-11-17", target: 22, isRecovery: false });
    expect(p.length).toBeGreaterThan(1);
  });
  it("redraws for a draft without saving", () => {
    const p = goalPreview(D, "sweetSpot", { mode: "progress", target: 30, stepMin: 4 });
    expect(p[0]!.target).toBe(30);
    // Week 3 is the third hit week in a row, so week 4 is a recovery week at 60% of the stepped-up 34.
    expect(p[1]).toMatchObject({ target: 20, isRecovery: true });
    expect(p[2]!.target).toBe(34);
  });
  it("hold stays flat and off is empty", () => {
    const hold = goalPreview(D, "sweetSpot", { mode: "hold", target: 25, stepMin: 0 });
    expect(new Set(hold.filter((x) => !x.isRecovery).map((x) => x.target))).toEqual(new Set([25]));
    expect(hold.filter((x) => x.isRecovery).every((x) => x.target === 15)).toBe(true);
    expect(goalPreview(D, "sweetSpot", { mode: "off", target: 25, stepMin: 0 })).toEqual([]);
  });
});
