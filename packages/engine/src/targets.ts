import { addDays } from "./dates";

/**
 * Zone goals. endurance = Z2+Z3, sweetSpot = 88-94% FTP (power rides only),
 * threshold = Z4, vo2 = Z5. Sweet spot overlaps Z3/Z4, so one interval can
 * count toward both sweetSpot and threshold.
 */
export type GoalKey = "endurance" | "sweetSpot" | "threshold" | "vo2";
export const GOAL_KEYS: readonly GoalKey[] = ["endurance", "sweetSpot", "threshold", "vo2"];

export type GoalMinutes = Record<GoalKey, number>;

/**
 * progress: the target steps up by `stepMin` after a week where it was hit,
 *           and repeats after a week where it wasn't.
 * hold:     a fixed target that never steps up.
 * off:      not tracked, not shown.
 */
export type GoalMode = "progress" | "hold" | "off";

export interface GoalConfig {
  mode: GoalMode;
  /** Target minutes in the program's first week. */
  start: number;
  /** Minutes added per hit week (progress mode). */
  stepMin: number;
}

export interface Program {
  /** Monday (America/Denver, "YYYY-MM-DD") of the first week. */
  startWeek: string;
  goals: Record<GoalKey, GoalConfig>;
  /**
   * After this many weeks in a row where every progress goal was hit, the
   * next week is a recovery week. 0 turns auto-recovery off.
   */
  recoveryAfter: number;
  /** Recovery-week targets as a fraction of the normal targets. */
  recoveryFactor: number;
}

/**
 * Defaults, 2026-11-08. Placeholders, not derived from the plan: edit them.
 * Off-season focus is sweet spot and VO2, so endurance holds and threshold is
 * off until wanted.
 */
export const DEFAULT_PROGRAM: Program = {
  startWeek: "2026-11-02",
  goals: {
    endurance: { mode: "hold", start: 90, stepMin: 0 },
    sweetSpot: { mode: "progress", start: 20, stepMin: 2 },
    threshold: { mode: "off", start: 10, stepMin: 1 },
    vo2: { mode: "progress", start: 8, stepMin: 1 },
  },
  recoveryAfter: 3,
  recoveryFactor: 0.6,
};

export interface ProgramWeek {
  /** Monday, "YYYY-MM-DD". */
  start: string;
  /** True once the week is over (a week in progress is not judged yet). */
  completed: boolean;
  isRecovery: boolean;
  /** This week's target minutes for each tracked goal that the plan serves this week. */
  targets: Partial<GoalMinutes>;
  /** Tracked goals the plan has no session for this week. Not judged, target carries over. */
  notPlanned: GoalKey[];
  /** Judged goals only: true if the week's actual met the target. Completed weeks only. */
  hit: Partial<Record<GoalKey, boolean>>;
  /** Consecutive all-hit weeks going into this week. */
  streakBefore: number;
}

export interface NextWeekProjection {
  start: string;
  isRecovery: boolean;
  targets: Partial<GoalMinutes>;
  notPlanned: GoalKey[];
  /** Full targets that apply when each unplanned goal returns (what "Back Nov 17 at 22 min" shows). */
  carried: GoalMinutes;
}

export interface ProgramState {
  weeks: ProgramWeek[];
  /** The week containing `today`, or null before the program starts. */
  current: ProgramWeek | null;
  /**
   * Targets for next week if this week's goals are all hit, so the Programming
   * view can show what's coming. Reflects recovery if the streak earns one.
   */
  nextIfHit: NextWeekProjection | null;
}

/**
 * A goal edit. It applies from `effectiveWeek` (a Monday) on. Weeks before it
 * keep the targets they were judged against. `start` resets the full target
 * to that value in the effective week; `mode` and `stepMin` change how later
 * weeks are judged and stepped.
 */
export interface GoalChange {
  effectiveWeek: string;
  goal: GoalKey;
  change: Partial<GoalConfig>;
}

export interface ProgramOptions {
  /**
   * Monday -> goals the plan has a session for that week. A goal missing from
   * a week's set is not judged that week: no hit, no miss, no step-up, and
   * its target carries over. A week with no entry (no plan data) counts as
   * everything planned.
   */
  planned?: ReadonlyMap<string, ReadonlySet<GoalKey>>;
  changes?: readonly GoalChange[];
}

function weeksBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / (7 * 24 * 3600 * 1000));
}

type Goals = Record<GoalKey, GoalConfig>;

const tracked = (g: Goals): GoalKey[] => GOAL_KEYS.filter((k) => g[k].mode !== "off");

function applyChanges(goals: Goals, full: GoalMinutes, changes: readonly GoalChange[], week: string) {
  for (const c of changes) {
    if (c.effectiveWeek !== week) continue;
    goals[c.goal] = { ...goals[c.goal], ...c.change };
    if (c.change.start !== undefined) full[c.goal] = c.change.start;
  }
}

function plannedSplit(goals: Goals, planned: ProgramOptions["planned"], week: string) {
  const set = planned?.get(week);
  const on: GoalKey[] = [];
  const off: GoalKey[] = [];
  for (const k of tracked(goals)) (!set || set.has(k) ? on : off).push(k);
  return { on, off };
}

function weekTargetsFor(p: Program, goals: Goals, full: GoalMinutes, recovery: boolean, on: GoalKey[]): Partial<GoalMinutes> {
  const out: Partial<GoalMinutes> = {};
  for (const g of on) out[g] = recovery ? Math.max(1, Math.round(full[g] * p.recoveryFactor)) : full[g];
  return out;
}

/**
 * Walks the program from its first week to the week containing `today`.
 * `actuals` maps a week's Monday to minutes per goal (missing weeks and goals
 * count as 0). Targets are derived from history every time, so nothing is
 * stored and nothing is hand-edited.
 *
 * Rules:
 * - A goal is judged only in weeks where the plan has a session for it
 *   (`options.planned`). An unplanned week counts as neither a hit nor a miss
 *   and carries the target over.
 * - A completed week where a progress goal was hit raises that goal by its
 *   stepMin. A miss repeats the same target. Each goal is judged separately.
 * - A streak counts weeks where every judged progress goal was hit. When it
 *   reaches `recoveryAfter`, the next week is a recovery week (reduced
 *   targets, not judged, no step-ups) and the streak resets. Any miss resets
 *   the streak. A week with no judged progress goal leaves the streak alone.
 * - Hold goals keep one target and don't affect the streak.
 * - Goal changes apply from their effective week on (`options.changes`).
 */
export function programState(
  p: Program,
  actuals: ReadonlyMap<string, Partial<GoalMinutes>>,
  currentWeekStart: string,
  options: ProgramOptions = {},
): ProgramState {
  const n = weeksBetween(p.startWeek, currentWeekStart);
  if (n < 0) return { weeks: [], current: null, nextIfHit: null };
  const changes = options.changes ?? [];

  const goals = { ...p.goals } as Goals;
  const full = {} as GoalMinutes;
  for (const g of GOAL_KEYS) full[g] = goals[g].start;
  let streak = 0;
  const weeks: ProgramWeek[] = [];

  for (let i = 0; i <= n; i++) {
    const start = addDays(p.startWeek, 7 * i);
    applyChanges(goals, full, changes, start);
    const completed = i < n;
    const isRecovery = p.recoveryAfter > 0 && streak >= p.recoveryAfter;
    const { on, off } = plannedSplit(goals, options.planned, start);
    const targets = weekTargetsFor(p, goals, full, isRecovery, on);
    const hit: Partial<Record<GoalKey, boolean>> = {};
    const row: ProgramWeek = { start, completed, isRecovery, targets, notPlanned: off, hit, streakBefore: streak };
    weeks.push(row);
    if (!completed) break;

    const a = actuals.get(start) ?? {};
    for (const g of on) hit[g] = (a[g] ?? 0) >= (targets[g] as number);

    if (isRecovery) {
      streak = 0; // resume at the same targets; they were already stepped up
      continue;
    }
    const judged = on.filter((g) => goals[g].mode === "progress");
    for (const g of judged) if (hit[g]) full[g] += goals[g].stepMin;
    if (judged.length > 0) streak = judged.every((g) => hit[g]) ? streak + 1 : 0;
  }

  const current = weeks[weeks.length - 1]!;
  // Project next week assuming this one is hit.
  const nextStart = addDays(current.start, 7);
  const ngoals = { ...goals } as Goals;
  const nf = { ...full };
  let nextStreak = current.streakBefore;
  if (!current.isRecovery) {
    const judged = GOAL_KEYS.filter((g) => !current.notPlanned.includes(g) && goals[g].mode === "progress");
    for (const g of judged) nf[g] += goals[g].stepMin;
    nextStreak = judged.length > 0 ? current.streakBefore + 1 : current.streakBefore;
  } else {
    nextStreak = 0;
  }
  applyChanges(ngoals, nf, changes, nextStart);
  const rec = p.recoveryAfter > 0 && nextStreak >= p.recoveryAfter;
  const { on, off } = plannedSplit(ngoals, options.planned, nextStart);
  const nextIfHit: NextWeekProjection = {
    start: nextStart,
    isRecovery: rec,
    targets: weekTargetsFor(p, ngoals, nf, rec, on),
    notPlanned: off,
    carried: nf,
  };
  return { weeks, current, nextIfHit };
}

export type GoalStatus = "hit" | "partial" | "none";

/** A goal is hit at 100% of target, and only then. Over-target still counts as hit. */
export function goalStatus(actualMin: number, targetMin: number): GoalStatus {
  if (actualMin >= targetMin) return "hit";
  return actualMin > 0 ? "partial" : "none";
}
