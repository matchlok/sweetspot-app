import { describe, expect, it } from "vitest";
import { generateProgram, type ProgramAvailability } from "../src/generate";
import { planViolations, type WeekSession } from "../src/options";
import { addDays, weekdayMon0 } from "../src/dates";
import { programState, GOAL_KEYS, type GoalMinutes } from "../src/targets";
import { goalServedBy } from "../src/plan";

const QUALITY = ["sweet_spot", "threshold", "vo2"];
const HISTORY = { asOf: "2026-11-21", liftsPerWeek: "unknown" as const }; // a Saturday
// Mon off, Tue 60, Wed 45, Thu 60, Fri off, Sat 120, Sun 90
const BUSY: ProgramAvailability = { minutes: [0, 60, 45, 60, 0, 120, 90] };
// Rides every day but Monday; forces the generator to work around adjacency.
const FULL: ProgramAvailability = { minutes: [0, 60, 60, 60, 60, 120, 90] };

const cards = [
  ["busy", generateProgram(HISTORY, BUSY, { kind: "faster" })],
  ["full", generateProgram(HISTORY, FULL, { kind: "hold" })],
] as const;

describe.each(cards)("generated program (%s)", (_name, card) => {
  const sessionsOf = (w: (typeof card.weeks)[number]) => w.sessions;

  it("starts on the Monday after asOf and runs 8 weeks by default", () => {
    expect(card.program.startWeek).toBe("2026-11-23");
    expect(weekdayMon0(card.program.startWeek)).toBe(0);
    expect(card.blockWeeks).toBe(8);
    expect(card.weeks).toHaveLength(8);
  });

  it("gives every progress goal a session in every non-recovery week (the VO2 gap)", () => {
    const progress = GOAL_KEYS.filter((g) => card.program.goals[g].mode === "progress");
    expect(progress).toContain("vo2");
    for (const w of card.weeks.filter((x) => !x.isRecovery)) {
      const served = new Set(sessionsOf(w).map((s) => goalServedBy(s.kind)));
      for (const g of progress) expect(served.has(g)).toBe(true);
    }
  });

  it("has endurance, sweet spot and VO2 in every week, no alternation", () => {
    for (const w of card.weeks) {
      const kinds = new Set(w.sessions.map((s) => s.kind));
      expect(kinds.has("endurance") && kinds.has("sweet_spot") && kinds.has("vo2")).toBe(true);
    }
  });

  it("never puts a quality ride the day after a lower lift, week boundary included", () => {
    const all = card.weeks.flatMap(sessionsOf);
    for (const lift of all.filter((s) => s.kind === "lift_lower")) {
      const next = addDays(lift.date, 1);
      expect(all.some((s) => s.date === next && QUALITY.includes(s.kind))).toBe(false);
    }
  });

  it("never puts quality rides on consecutive days, week boundary included", () => {
    const all = card.weeks.flatMap(sessionsOf);
    for (const q of all.filter((s) => QUALITY.includes(s.kind))) {
      expect(all.some((s) => s.date === addDays(q.date, 1) && QUALITY.includes(s.kind))).toBe(false);
    }
  });

  it("places the lift days itself, one per day and clear of the options.ts hard rules", () => {
    for (const w of card.weeks) {
      const lifts = w.sessions.filter((s) => s.kind.startsWith("lift_"));
      expect(lifts.map((l) => l.kind).sort()).toEqual(["lift_lower", "lift_upper"]);
      expect(new Set(lifts.map((l) => l.date)).size).toBe(lifts.length);
      const ws: WeekSession[] = w.sessions.map((s) => ({ ...s, status: "planned" as const }));
      expect(planViolations(ws).filter((v) => v.hard)).toEqual([]);
    }
  });

  it("puts every session on the right weekday inside its week", () => {
    for (const w of card.weeks) {
      for (const s of w.sessions) {
        expect(s.date >= w.start && s.date <= addDays(w.start, 6)).toBe(true);
      }
    }
    // Saturday Nov 28 2026 holds the long ride in week 1.
    expect(card.weeks[0]!.sessions.find((s) => s.kind === "endurance")!.date).toBe("2026-11-28");
  });

  it("follows the streak rule for recovery weeks: planned after three all-hit weeks", () => {
    const actuals = new Map<string, Partial<GoalMinutes>>();
    const expected: boolean[] = [];
    for (const w of card.weeks) {
      const state = programState(card.program, actuals, w.start);
      expected.push(state.current!.isRecovery);
      actuals.set(w.start, { ...state.current!.targets });
    }
    expect(card.weeks.map((w) => w.isRecovery)).toEqual(expected);
    expect(expected.filter(Boolean).length).toBeGreaterThan(0);
  });

  it("cuts volume only in recovery weeks: same sessions, 60-70% of the ride minutes", () => {
    const normal = card.weeks.find((w) => !w.isRecovery)!;
    const rec = card.weeks.find((w) => w.isRecovery)!;
    expect(rec.sessions.map((s) => s.kind)).toEqual(normal.sessions.map((s) => s.kind));
    expect(rec.sessions.map((s) => weekdayMon0(s.date))).toEqual(normal.sessions.map((s) => weekdayMon0(s.date)));
    const rideMin = (w: typeof normal) => w.sessions.filter((s) => !s.kind.startsWith("lift_")).reduce((a, s) => a + s.minutes, 0);
    const ratio = rideMin(rec) / rideMin(normal);
    expect(ratio).toBeGreaterThanOrEqual(0.55);
    expect(ratio).toBeLessThanOrEqual(0.7);
  });
});

describe("generator inputs", () => {
  it("keeps the long ride on the weekend", () => {
    for (const [, card] of cards) {
      for (const w of card.weeks) {
        const long = w.sessions.find((s) => s.kind === "endurance")!;
        expect(weekdayMon0(long.date)).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("brings threshold on and holds sweet spot with a race inside 6 weeks", () => {
    const card = generateProgram(HISTORY, FULL, { kind: "race", raceDate: "2026-12-20" });
    expect(card.program.goals.threshold.mode).toBe("progress");
    expect(card.program.goals.sweetSpot.mode).toBe("hold");
    expect(card.blockWeeks).toBe(4);
    for (const w of card.weeks.filter((x) => !x.isRecovery)) {
      expect(w.sessions.some((s) => s.kind === "threshold")).toBe(true);
    }
  });

  it("caps a race block at 12 weeks", () => {
    expect(generateProgram(HISTORY, BUSY, { kind: "race", raceDate: "2027-06-01" }).blockWeeks).toBe(12);
  });

  it("drops endurance to hold 60 under 2.5 h", () => {
    const card = generateProgram(HISTORY, { minutes: [0, 45, 0, 45, 0, 50, 0] }, { kind: "faster" });
    expect(card.program.goals.endurance).toEqual({ mode: "hold", start: 60, stepMin: 0 });
  });

  it("leaves lift count unknown rather than inventing history, and says so", () => {
    expect(cards[0][1].assumptions.join(" ")).toMatch(/unknown/);
    const one = generateProgram({ asOf: "2026-11-21", liftsPerWeek: 1 }, BUSY, { kind: "faster" });
    expect(one.weeks[0]!.sessions.filter((s) => s.kind.startsWith("lift_"))).toHaveLength(1);
  });

  it("throws when availability can't hold the rides", () => {
    expect(() => generateProgram(HISTORY, { minutes: [0, 60, 0, 60, 0, 0, 0] }, { kind: "faster" })).toThrow();
  });
  // The onboarding prototype's screen 4 -> 5 week (docs/build-writeup/2026-11-22-onboarding-prototype/README.md).
  it("builds the onboarding prototype's week, with no ride the day after the lower lift", () => {
    const card = generateProgram({ asOf: "2026-11-21", liftsPerWeek: 2 }, { minutes: [0, 60, 0, 45, 0, 120, 45] }, { kind: "faster" });
    expect(card.weeks[0]!.sessions.map((s) => `${weekdayMon0(s.date)} ${s.kind} ${s.minutes}`)).toEqual([
      "0 lift_upper 30",
      "1 sweet_spot 60",
      "3 vo2 45",
      "4 lift_lower 30",
      "5 endurance 120",
      "6 easy_spin 45",
    ]);
  });
});
