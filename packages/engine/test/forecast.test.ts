import { describe, expect, it } from "vitest";
import { forecastProgram, recentRates, MIN_JUDGED_WEEKS } from "../src/forecast";
import { generateProgram } from "../src/generate";
import { DEFAULT_PROGRAM, programState, type GoalMinutes } from "../src/targets";
import { addDays } from "../src/dates";

const card = generateProgram({ asOf: "2026-11-27", liftsPerWeek: "unknown" }, { minutes: [0, 60, 45, 60, 0, 120, 90] }, { kind: "faster" });
// 8 weeks: recovery weeks are weeks 4 and 8, so 6 weeks step the target before the last one.
const byKey = (f: ReturnType<typeof forecastProgram>) => Object.fromEntries(f.map((x) => [x.key, x]));

describe("forecastProgram", () => {
  it("covers progress goals only", () => {
    expect(forecastProgram(card, {}).map((f) => f.key)).toEqual(["sweetSpot", "vo2"]);
  });

  it("all hit: start plus a step per non-recovery week judged before the last week", () => {
    const f = byKey(forecastProgram(card, {}));
    expect(card.weeks.map((w) => w.isRecovery)).toEqual([false, false, false, true, false, false, false, true]);
    expect(f.sweetSpot).toMatchObject({ start: 20, stepMin: 1, ifAllHit: { target: 26 } });
    expect(f.vo2).toMatchObject({ start: 8, stepMin: 1, ifAllHit: { target: 14 } });
    // The date is the goal's session in the last block week.
    const last = card.weeks[7]!;
    expect(f.sweetSpot!.ifAllHit.date).toBe(last.sessions.find((s) => s.kind === "sweet_spot")!.date);
  });

  it("6 of 8 scales the step-ups by 6/8, rounded down", () => {
    const f = byKey(forecastProgram(card, { sweetSpot: { hit: 6, judged: 8 }, vo2: { hit: 8, judged: 8 } }));
    expect(f.sweetSpot!.atRecentRate).toEqual({ hit: 6, judged: 8, target: 24 }); // floor(6 x 6/8) = 4
    expect(f.vo2!.atRecentRate).toEqual({ hit: 8, judged: 8, target: 14 });
  });

  it("no history gives null, never a guess", () => {
    const f = forecastProgram(card, {});
    expect(f.every((x) => x.atRecentRate === null)).toBe(true);
    const few = forecastProgram(card, { sweetSpot: { hit: 1, judged: MIN_JUDGED_WEEKS - 1 } });
    expect(few[0]!.atRecentRate).toBeNull();
  });

  it("a threshold goal that turns on carries its own start", () => {
    const race = generateProgram({ asOf: "2026-11-27", liftsPerWeek: "unknown" }, { minutes: [0, 60, 45, 60, 0, 120, 90] }, { kind: "race", raceDate: "2026-12-20" });
    const f = byKey(forecastProgram(race, {}));
    expect(f.threshold).toBeDefined();
    expect(f.sweetSpot).toBeUndefined(); // holds before the race
  });
});

describe("recentRates", () => {
  it("counts hits and judged weeks over the last 8 completed weeks, skipping recovery weeks", () => {
    const p = { ...DEFAULT_PROGRAM, startWeek: "2026-08-31" };
    // 12 completed weeks, then the current one. Sweet spot always hit; VO2 hit in alternate weeks.
    const actuals = new Map<string, Partial<GoalMinutes>>();
    for (let i = 0; i < 12; i++) actuals.set(addDays(p.startWeek, 7 * i), { endurance: 999, sweetSpot: 999, vo2: i % 2 === 0 ? 999 : 0 });
    const state = programState(p, actuals, addDays(p.startWeek, 84));
    const r = recentRates(state);
    expect(r.sweetSpot!.hit).toBe(r.sweetSpot!.judged);
    expect(r.sweetSpot!.judged).toBeLessThanOrEqual(8);
    expect(r.vo2!.hit).toBeLessThan(r.vo2!.judged);
    expect(r.threshold).toBeUndefined(); // off: never judged
  });

  it("is empty before any week has completed", () => {
    expect(recentRates(programState(DEFAULT_PROGRAM, new Map(), DEFAULT_PROGRAM.startWeek))).toEqual({});
  });
});
