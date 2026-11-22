import { addDays, mondayOf } from "./dates";
import type { SessionKind } from "./calendar";
import { planViolations, type WeekSession } from "./options";
import { DEFAULT_PROGRAM, type GoalKey, type Program } from "./targets";

/**
 * Program generator: history + availability + purpose -> program card.
 * Pure and deterministic; no LLM, no network (rule 1). Plan:
 * docs/plans/ONBOARDING-COACH.md, "Generator".
 */

export type ProgramPurposeKind = "race" | "faster" | "comeback" | "hold";

export interface ProgramPurpose {
  kind: ProgramPurposeKind;
  /** Race day, "YYYY-MM-DD" (Denver). Required for kind "race". */
  raceDate?: string;
}

export interface ProgramHistory {
  /** Today's Denver date. The block starts on the Monday after it. */
  asOf: string;
  /** Strength sessions a week over recent weeks. "unknown" when the sources can't say; never guessed. */
  liftsPerWeek: number | "unknown";
}

export interface ProgramAvailability {
  /** Minutes available per day, Monday first (7 entries). 0 = off. */
  minutes: readonly number[];
}

export interface GeneratedSession {
  /** `${date}|${kind}`. */
  id: string;
  /** "YYYY-MM-DD", America/Denver. */
  date: string;
  kind: SessionKind;
  title: string;
  minutes: number;
}

export interface GeneratedWeek {
  /** Monday. */
  start: string;
  /** Planned if every earlier week is hit (the streak rule). It moves when a week is missed. */
  isRecovery: boolean;
  sessions: GeneratedSession[];
}

export interface ProgramCard {
  purpose: ProgramPurpose;
  program: Program;
  blockWeeks: number;
  weeks: GeneratedWeek[];
  /** Plain statements of anything assumed, for the card to show. */
  assumptions: string[];
}

export const QUALITY_MIN = 45;
export const LIFT_MINUTES = 30;
export const DEFAULT_LIFTS_PER_WEEK = 2;
export const MAX_BLOCK_WEEKS = 12;
export const DEFAULT_BLOCK_WEEKS = 8;
const LOW_TIME_MIN = 150;
const RACE_SOON_DAYS = 42;

const TITLE: Record<SessionKind, string> = {
  endurance: "Endurance",
  sweet_spot: "Sweet Spot",
  threshold: "Threshold",
  vo2: "VO2 Max Intervals",
  easy_spin: "Easy Spin",
  lift_upper: "Lift B - Upper Body",
  lift_lower: "Lift A - Lower Body + Core",
};

const GOAL_KIND: Record<GoalKey, SessionKind> = {
  endurance: "endurance",
  sweetSpot: "sweet_spot",
  threshold: "threshold",
  vo2: "vo2",
};

const title = (kind: SessionKind, minutes: number) => `${TITLE[kind]} (${minutes} min)`;
const roundTo5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Ordered picks of `k` distinct items, in a fixed order. */
function* arrange<T>(items: readonly T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of arrange(rest, k - 1)) yield [items[i]!, ...tail];
  }
}

interface Layout {
  /** weekday (Mon = 0) -> ride kind */
  rides: Map<number, SessionKind>;
  /** lifts[i] goes on weekday liftDays[i] */
  liftDays: number[];
  lifts: SessionKind[];
}

/**
 * Runs the options.ts rule gate over the layout repeated for two weeks (so
 * Sunday into Monday is checked). Hard violations and back-to-back quality
 * rides reject the layout; other warnings count against it.
 */
function gate(layout: Layout, allowLongRideOffWeekend: boolean): { ok: boolean; warns: number } {
  const monday = "2026-01-05"; // any Monday: only relative days matter
  const sessions: WeekSession[] = [];
  const add = (date: string, kind: SessionKind) =>
    sessions.push({ id: `${date}|${kind}`, date, kind, title: kind, minutes: null, status: "planned" });
  for (const w of [0, 1]) {
    for (const [d, k] of layout.rides) add(addDays(monday, 7 * w + d), k);
    layout.liftDays.forEach((d, i) => add(addDays(monday, 7 * w + d), layout.lifts[i]!));
  }
  const v = planViolations(sessions, allowLongRideOffWeekend);
  const ok = !v.some((x) => x.hard || x.rule === "quality_back_to_back");
  return { ok, warns: v.length };
}

/** Lifts prefer off or short days, then easy spins, then endurance, and least a quality day. */
function liftCost(day: number, layout: Layout, minutes: readonly number[]): number {
  const ride = layout.rides.get(day);
  if (!ride) return 0;
  if (ride === "easy_spin") return 1;
  if (ride === "endurance") return 2;
  return minutes[day]! < QUALITY_MIN ? 1 : 5;
}

/** Cheapest rule-clean week, or null when the availability can't hold the rides. */
function layoutWeek(minutes: readonly number[], rideKinds: readonly SessionKind[], lifts: readonly SessionKind[]): Layout | null {
  const rideDays = minutes.map((m, d) => (m > 0 ? d : -1)).filter((d) => d >= 0);
  if (rideDays.length < rideKinds.length) return null;
  const quality = rideKinds.filter((k) => k !== "endurance");
  const longest = Math.max(...rideDays.map((d) => minutes[d]!));

  // The long ride keeps the weekend; only leave it when there is no way to keep it.
  for (const allowOff of [false, true]) {
    let best: { layout: Layout; cost: number } | null = null;
    for (const perm of arrange(rideDays, rideKinds.length)) {
      const [endDay, ...qDays] = perm as [number, ...number[]];
      if (qDays.some((d) => minutes[d]! < QUALITY_MIN)) continue;
      const rides = new Map<number, SessionKind>([[endDay, "endurance"]]);
      qDays.forEach((d, i) => rides.set(d, quality[i]!));
      for (const d of rideDays) if (!rides.has(d)) rides.set(d, "easy_spin");
      const ridesOnly = gate({ rides, liftDays: [], lifts: [] }, allowOff);
      if (!ridesOnly.ok) continue;

      for (const liftDays of arrange([0, 1, 2, 3, 4, 5, 6], lifts.length)) {
        const layout: Layout = { rides, liftDays, lifts: [...lifts] };
        const g = gate(layout, allowOff);
        if (!g.ok) continue;
        const cost = (longest - minutes[endDay]!) * 10 + g.warns * 3 + liftDays.reduce((s, d) => s + liftCost(d, layout, minutes), 0);
        if (!best || cost < best.cost) best = { layout, cost };
      }
    }
    if (best) return best.layout;
  }
  return null;
}

/**
 * Builds the program card. Throws when the availability can't hold the week's
 * rides, rather than quietly dropping a progress goal's session.
 *
 * - Goals start from DEFAULT_PROGRAM. Under 2.5 h a week endurance holds at
 *   60. A race inside 6 weeks turns threshold on and holds sweet spot.
 * - Every tracked ride goal gets a session every week, recovery weeks included.
 * - Recovery weeks come from the streak rule on an all-hit path and cut
 *   session length by `recoveryFactor`. Same sessions, same intensity.
 * - Quality rides (sweet spot, threshold, VO2) need a 45+ min day, never fall
 *   on consecutive days or the day after a lower lift. The generator picks the
 *   lift days.
 */
export function generateProgram(history: ProgramHistory, availability: ProgramAvailability, purpose: ProgramPurpose): ProgramCard {
  if (availability.minutes.length !== 7) throw new Error("availability needs 7 days, Monday first");
  const startWeek = addDays(mondayOf(history.asOf), 7);
  const assumptions: string[] = [];
  const total = availability.minutes.reduce((a, b) => a + b, 0);

  const goals = structuredClone(DEFAULT_PROGRAM.goals);
  if (total < LOW_TIME_MIN) {
    goals.endurance = { mode: "hold", start: 60, stepMin: 0 };
    assumptions.push("Under 2.5 h a week, so endurance holds at 60 min.");
  }
  let blockWeeks = DEFAULT_BLOCK_WEEKS;
  if (purpose.kind === "race") {
    if (!purpose.raceDate) throw new Error("a race block needs a race date");
    const toRace = daysBetween(startWeek, purpose.raceDate);
    blockWeeks = Math.min(MAX_BLOCK_WEEKS, Math.max(1, Math.floor(toRace / 7) + 1));
    if (toRace < RACE_SOON_DAYS) {
      goals.threshold = { ...DEFAULT_PROGRAM.goals.threshold, mode: "progress" };
      goals.sweetSpot = { ...goals.sweetSpot, mode: "hold", stepMin: 0 };
      assumptions.push("Race inside 6 weeks: threshold comes on and sweet spot holds.");
    }
  }
  const program: Program = { ...DEFAULT_PROGRAM, startWeek, goals };

  const rideKinds = (Object.keys(GOAL_KIND) as GoalKey[]).filter((g) => goals[g].mode !== "off").map((g) => GOAL_KIND[g]);

  const liftCount = history.liftsPerWeek === "unknown" ? DEFAULT_LIFTS_PER_WEEK : Math.max(0, Math.min(2, Math.floor(history.liftsPerWeek)));
  if (history.liftsPerWeek === "unknown") assumptions.push(`Lifts a week unknown, so ${DEFAULT_LIFTS_PER_WEEK} (lower and upper).`);
  const lifts = (["lift_lower", "lift_upper"] as const).slice(0, liftCount);

  const layout = layoutWeek(availability.minutes, rideKinds, lifts);
  if (!layout) {
    throw new Error(`availability can't hold ${rideKinds.length} rides (quality rides need ${QUALITY_MIN}+ min and never fall on consecutive days)`);
  }

  const weeks: GeneratedWeek[] = [];
  let streak = 0;
  for (let i = 0; i < blockWeeks; i++) {
    const start = addDays(startWeek, 7 * i);
    const isRecovery = program.recoveryAfter > 0 && streak >= program.recoveryAfter;
    streak = isRecovery ? 0 : streak + 1;
    const sessions: GeneratedSession[] = [];
    const push = (day: number, kind: SessionKind, minutes: number) => {
      const date = addDays(start, day);
      sessions.push({ id: `${date}|${kind}`, date, kind, title: title(kind, minutes), minutes });
    };
    for (const [day, kind] of layout.rides) {
      const base = availability.minutes[day]!;
      push(day, kind, isRecovery ? roundTo5(base * program.recoveryFactor) : base);
    }
    layout.liftDays.forEach((day, j) => push(day, layout.lifts[j]!, LIFT_MINUTES));
    sessions.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
    weeks.push({ start, isRecovery, sessions });
  }

  return { purpose, program, blockWeeks, weeks, assumptions };
}
