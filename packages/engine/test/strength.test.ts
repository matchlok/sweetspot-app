import { describe, expect, it } from "vitest";
import type { PlannedSession } from "../src/calendar";
import { tagFromText, weekStrength } from "../src/strength";

describe("tagFromText", () => {
  it("reads upper and lower words", () => {
    expect(tagFromText("Upper body push day")).toBe("upper");
    expect(tagFromText("legs and squats")).toBe("lower");
    expect(tagFromText("Lower")).toBe("lower");
    expect(tagFromText("100lb bench 2x5 1x3")).toBe("upper");
    expect(tagFromText("3x 95 squat, 3x95lb sumo DL")).toBe("lower");
  });
  it("reads Lift A as lower and Lift B as upper", () => {
    expect(tagFromText("Lift A")).toBe("lower");
    expect(tagFromText("lift b, easy")).toBe("upper");
    expect(tagFromText("LiftB")).toBe("upper");
  });
  it("tolerates a one-character typo on longer words", () => {
    expect(tagFromText("uper body")).toBe("upper");
    expect(tagFromText("lowwer")).toBe("lower");
    expect(tagFromText("squatss")).toBe("lower");
  });
  it("is null when the text says both, neither or nothing", () => {
    expect(tagFromText("upper and lower")).toBeNull();
    expect(tagFromText("Morning Weight Training")).toBeNull();
    expect(tagFromText("")).toBeNull();
    expect(tagFromText(undefined)).toBeNull();
  });
});

const plan = (id: string, date: string, kind: PlannedSession["kind"], status: PlannedSession["status"] = "planned"): PlannedSession =>
  ({ id, date, kind, title: kind, minutes: 30, status }) as PlannedSession;

const planned = [plan("mon-up", "2026-11-16", "lift_upper"), plan("thu-lo", "2026-11-19", "lift_lower")];

describe("weekStrength", () => {
  it("counts any strength activity once, of any length and on any day", () => {
    const s = weekStrength(planned, [{ id: "a", date: "2026-11-18", movingSeconds: 785 }, { id: "b", date: "2026-11-20", movingSeconds: 60 }]);
    expect(s.total).toBe(2);
    expect(s.untagged).toBe(2);
  });
  it("an untagged lift fills the total but not a bucket, and never guesses", () => {
    const s = weekStrength(planned, [{ id: "a", date: "2026-11-18", movingSeconds: 900, text: "Morning Weight Training" }]);
    expect(s).toMatchObject({ total: 1, upper: 0, lower: 0, untagged: 1 });
    expect(s.lifts[0]).toMatchObject({ tag: null, tagSource: null });
    expect(s.lifts[0]!.sessionId).toBeUndefined();
  });
  it("a tag from the note counts and settles the earliest open planned lift of that type", () => {
    const s = weekStrength(planned, [{ id: "a", date: "2026-11-18", movingSeconds: 900, text: "Lift A" }]);
    expect(s).toMatchObject({ total: 1, lower: 1, untagged: 0 });
    expect(s.lifts[0]).toMatchObject({ tag: "lower", tagSource: "note", sessionId: "thu-lo" });
  });
  it("a tap beats the note, and the note beats the planned day", () => {
    const lifts = [{ id: "a", date: "2026-11-16", movingSeconds: 900, text: "legs" }];
    expect(weekStrength(planned, lifts).lifts[0]).toMatchObject({ tag: "lower", tagSource: "note" });
    expect(weekStrength(planned, lifts, new Map([["a", "upper" as const]])).lifts[0]).toMatchObject({ tag: "upper", tagSource: "manual" });
  });
  it("falls back to the planned lift on the same day", () => {
    const s = weekStrength(planned, [{ id: "a", date: "2026-11-16", movingSeconds: 900 }]);
    expect(s.lifts[0]).toMatchObject({ tag: "upper", tagSource: "plan", sessionId: "mon-up" });
  });
  it("two lifts of one type settle one session each, in order", () => {
    const two = [plan("s1", "2026-11-16", "lift_upper"), plan("s2", "2026-11-18", "lift_upper")];
    const s = weekStrength(two, [
      { id: "a", date: "2026-11-19", movingSeconds: 900, text: "upper" },
      { id: "b", date: "2026-11-20", movingSeconds: 900, text: "upper" },
      { id: "c", date: "2026-11-21", movingSeconds: 900, text: "upper" },
    ]);
    expect(s.lifts.map((l) => l.sessionId)).toEqual(["s1", "s2", undefined]);
    expect(s.upper).toBe(3);
  });
  it("skipped planned lifts are not settled", () => {
    const s = weekStrength([plan("sk", "2026-11-16", "lift_upper", "skipped")], [{ id: "a", date: "2026-11-17", movingSeconds: 900, text: "upper" }]);
    expect(s.lifts[0]!.sessionId).toBeUndefined();
  });
});
