import { describe, expect, it } from "vitest";
import { DEFAULT_PROGRAM, goalStatus, programState, type GoalMinutes, type Program } from "../src/targets";

// Weeks: 11-02, 11-09, 11-16, 11-23, 11-30, 12-07
const W = ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07"];
const P: Program = DEFAULT_PROGRAM; // SS 20 +2, VO2 8 +1, endurance holds at 90, threshold off

function acts(rows: Array<Partial<GoalMinutes>>) {
  return new Map(rows.map((r, i) => [W[i]!, r]));
}
const hitAll = { endurance: 0, sweetSpot: 999, vo2: 999 };

describe("programState", () => {
  it("starts at the configured targets and skips off goals", () => {
    const s = programState(P, new Map(), W[0]!);
    expect(s.current!.targets).toEqual({ endurance: 90, sweetSpot: 20, vo2: 8 });
    expect(s.current!.targets.threshold).toBeUndefined();
  });

  it("is empty before the program starts", () => {
    expect(programState(P, new Map(), "2026-10-26").current).toBeNull();
  });

  it("steps a goal up only after it was hit, per goal", () => {
    // Week 1: SS hit (25 >= 20), VO2 missed (5 < 8).
    const s = programState(P, acts([{ sweetSpot: 25, vo2: 5 }]), W[1]!);
    expect(s.current!.targets).toEqual({ endurance: 90, sweetSpot: 22, vo2: 8 });
    expect(s.weeks[0]!.hit).toMatchObject({ sweetSpot: true, vo2: false });
  });

  it("repeats the same targets after a miss", () => {
    const s = programState(P, acts([{ sweetSpot: 3, vo2: 10 }, { sweetSpot: 22, vo2: 9 }]), W[2]!);
    // week 1: SS missed (stays 20), VO2 hit (9). week 2: SS 22 >= 20 hit => 22, VO2 9 >= 9 hit => 10
    expect(s.weeks[1]!.targets).toEqual({ endurance: 90, sweetSpot: 20, vo2: 9 });
    expect(s.current!.targets).toEqual({ endurance: 90, sweetSpot: 22, vo2: 10 });
  });

  it("does not judge or step up the week in progress", () => {
    const s = programState(P, acts([{ sweetSpot: 999, vo2: 999 }]), W[0]!);
    expect(s.current!.completed).toBe(false);
    expect(s.current!.hit).toEqual({});
    expect(s.current!.targets.sweetSpot).toBe(20);
  });

  it("makes the 4th week a recovery week after 3 all-hit weeks, then resumes", () => {
    const s = programState(P, acts([hitAll, hitAll, hitAll, hitAll]), W[4]!);
    // after 3 hits: SS 26, VO2 11
    expect(s.weeks[3]!.isRecovery).toBe(true);
    expect(s.weeks[3]!.targets).toEqual({ endurance: 54, sweetSpot: 16, vo2: 7 }); // 60% of 90/26/11
    // recovery week doesn't step anything up, so week 5 resumes at the same full targets
    expect(s.current!.isRecovery).toBe(false);
    expect(s.current!.targets).toEqual({ endurance: 90, sweetSpot: 26, vo2: 11 });
    expect(s.current!.streakBefore).toBe(0);
  });

  it("any miss resets the streak", () => {
    const s = programState(P, acts([hitAll, hitAll, { sweetSpot: 0, vo2: 999 }, hitAll]), W[4]!);
    expect(s.weeks.some((w) => w.isRecovery)).toBe(false);
  });

  it("hold goals never step and never affect the streak", () => {
    const s = programState(P, acts([{ endurance: 500, sweetSpot: 999, vo2: 999 }]), W[1]!);
    expect(s.current!.targets.endurance).toBe(90);
    expect(s.current!.streakBefore).toBe(1);
  });

  it("supports a custom step per goal and threshold as a goal", () => {
    const prog: Program = {
      ...P,
      goals: { ...P.goals, threshold: { mode: "progress", start: 10, stepMin: 1 }, sweetSpot: { mode: "off", start: 20, stepMin: 2 } },
    };
    const s = programState(prog, acts([{ threshold: 12, vo2: 9 }]), W[1]!);
    expect(s.current!.targets).toEqual({ endurance: 90, threshold: 11, vo2: 9 });
  });

  it("projects next week if this one is hit, including an earned recovery", () => {
    const s = programState(P, acts([hitAll, hitAll]), W[2]!); // 2 hits so far, third in progress
    expect(s.nextIfHit!.isRecovery).toBe(true);
    const t = programState(P, new Map(), W[0]!);
    expect(t.nextIfHit!.targets).toEqual({ endurance: 90, sweetSpot: 22, vo2: 9 });
  });
});

describe("goalStatus", () => {
  it("is hit only at 100% or more", () => {
    expect(goalStatus(90, 90)).toBe("hit");
    expect(goalStatus(120, 90)).toBe("hit");
    expect(goalStatus(89.9, 90)).toBe("partial");
    expect(goalStatus(0, 90)).toBe("none");
  });
});
