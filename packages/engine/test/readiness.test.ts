import { describe, expect, it } from "vitest";
import { hardDaysBefore, readiness, scoreReading } from "../src/readiness";
import { readinessOutcome, readinessPrediction, homeView } from "../src/views";
import type { Fatigue } from "../src/fatigue";
import type { RideZones } from "../src/intervals";
import { v4Scenario as D } from "./fixtures/scenario";

const fat = (form: number, rampRate: number | null = 2): Fatigue => ({ date: "2026-11-10", fitness: 40, fatigue: 40 - form, form, rampRate });
const ride = (date: string, category: RideZones["category"]): RideZones => ({ id: date, date, movingSeconds: 3600, category, categorySource: "power" });

describe("readiness", () => {
  it("is green when every input is fine", () => {
    const r = readiness(fat(-5), [], "2026-11-10")!;
    expect(r).toMatchObject({ light: "green", label: "Ready", reasons: [], provisional: true });
    expect(r.inputs.map((i) => i.key)).toEqual(["form", "ramp", "hardDays"]);
  });

  it("takes the worst of the inputs", () => {
    expect(readiness(fat(-15), [], "2026-11-10")!.light).toBe("yellow");
    expect(readiness(fat(-25), [], "2026-11-10")!.light).toBe("red");
    expect(readiness(fat(0, 6), [], "2026-11-10")!.light).toBe("yellow");
    expect(readiness(fat(0, 9), [], "2026-11-10")!.light).toBe("red");
    // One red input wins over greens.
    expect(readiness(fat(0, 2), [ride("2026-11-07", "vo2"), ride("2026-11-08", "sweet_spot"), ride("2026-11-09", "vo2")], "2026-11-10")!.light).toBe("red");
  });

  it("sits on the thresholds: -10 is green, -20 is yellow", () => {
    expect(readiness(fat(-10), [], "2026-11-10")!.light).toBe("green");
    expect(readiness(fat(-20), [], "2026-11-10")!.light).toBe("yellow");
    expect(readiness(fat(0, 5), [], "2026-11-10")!.light).toBe("green");
    expect(readiness(fat(0, 8), [], "2026-11-10")!.light).toBe("yellow");
  });

  it("counts hard days in the 3 days before, once per day, and ignores easy rides and today", () => {
    const rides = [ride("2026-11-06", "vo2"), ride("2026-11-07", "vo2"), ride("2026-11-07", "sweet_spot"), ride("2026-11-08", "endurance"), ride("2026-11-10", "vo2")];
    expect(hardDaysBefore(rides, "2026-11-10")).toEqual(["2026-11-07"]);
    expect(readiness(fat(0), rides, "2026-11-10")!.inputs.find((i) => i.key === "hardDays")!.value).toBe("1 of the last 3 days");
  });

  it("explains each input that isn't green", () => {
    const r = readiness(fat(-25, 9), [ride("2026-11-08", "vo2"), ride("2026-11-09", "sweet_spot")], "2026-11-10")!;
    expect(r.reasons).toEqual([
      "Form is −25: you're carrying fatigue.",
      "Fitness is rising +9 per week, faster than usual.",
      "2 hard days in the last 3.",
    ]);
  });

  it("never guesses: no wellness row means no reading, and a missing ramp is listed", () => {
    expect(readiness(null, [], "2026-11-10")).toBeNull();
    const r = readiness(fat(-5, null), [], "2026-11-10")!;
    expect(r.missing).toEqual(["Ramp rate"]);
    expect(r.inputs.map((i) => i.key)).toEqual(["form", "hardDays"]);
  });

  it("shows on Home from the scenario's wellness row", () => {
    const home = homeView(D);
    expect(home.readiness).toMatchObject({ light: "green" }); // form -5, ramp 3.2, no hard days
  });
});

describe("prediction and scoring", () => {
  it("predicts a shortfall for yellow and red, completion for green, tied to today's session", () => {
    const p = readinessPrediction(D)!;
    expect(p).toMatchObject({ date: "2026-11-10", light: "green", sessionId: "w2-vo2", kind: "vo2", expect: "completes" });
    const tired = readinessPrediction({ ...D, wellness: [{ id: "2026-11-10", ctl: 40, atl: 62, rampRate: 3 }] })!;
    expect(tired).toMatchObject({ light: "red", expect: "shortfall" });
  });

  it("has no outcome while the day is still running", () => {
    expect(readinessOutcome(D, readinessPrediction(D)!)).toBeNull();
  });

  it("scores against the day's minutes once the day is over", () => {
    const p = readinessPrediction(D)!;
    const next = { ...D, today: "2026-11-11", now: new Date("2026-11-11T14:30:00Z") };
    // No VO2 ride was logged: the session was not done.
    const missed = readinessOutcome(next, p)!;
    expect(missed).toMatchObject({ done: false, completed: false, targetMin: 9 });
    expect(scoreReading(p, missed)).toEqual({ correct: false, predicted: "completes", actual: "shortfall" });

    // A ride with 10 min in Z5 meets the 9 min target.
    const rides = [...D.rides, { id: "r9", date: "2026-11-10", movingSeconds: 3600, category: "unknown" as const, categorySource: null, power: [300, 1200, 0, 0, 600, 0, 0] }];
    const hit = readinessOutcome({ ...next, rides }, p)!;
    expect(hit).toMatchObject({ done: true, goalMinutes: 10, targetMin: 9, completed: true });
    expect(scoreReading(p, hit).correct).toBe(true);

    // A ride short of target is a shortfall, which a yellow or red reading would have called right.
    const shortRides = [...D.rides, { id: "r9", date: "2026-11-10", movingSeconds: 3600, category: "unknown" as const, categorySource: null, power: [300, 1200, 0, 0, 300, 0, 0] }];
    const short = readinessOutcome({ ...next, rides: shortRides }, p)!;
    expect(short).toMatchObject({ done: true, completed: false, goalMinutes: 5 });
  });

  it("has no prediction target on a day with no session", () => {
    const p = readinessPrediction(D, "2026-11-13")!; // Friday: nothing planned
    expect(p.sessionId).toBeNull();
    expect(readinessOutcome({ ...D, today: "2026-11-14" }, p)).toBeNull();
  });
});
