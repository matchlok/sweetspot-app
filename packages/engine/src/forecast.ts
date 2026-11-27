import type { SessionKind } from "./calendar";
import type { ProgramCard } from "./generate";
import { GOAL_KEYS, type GoalKey, type ProgramState } from "./targets";

/**
 * Program forecast: where each progress goal's target goes over a block, if
 * every week is hit and at the recent hit rate. Pure. These are targets, not
 * fitness claims (AGENTS.md rule 6).
 */

/** Fewer judged weeks than this and the recent rate is not shown (never guessed). */
export const MIN_JUDGED_WEEKS = 3;
/** How many completed weeks the recent rate looks back over. */
export const RECENT_WEEKS = 8;

export interface RecentRate {
  hit: number;
  judged: number;
}

export type RecentRates = Partial<Record<GoalKey, RecentRate>>;

export interface GoalForecast {
  key: GoalKey;
  /** The target in the block's first week. */
  start: number;
  stepMin: number;
  /** Where the target lands in the block's last week if every week is hit. */
  ifAllHit: { date: string; target: number };
  /** The same at the recent hit rate. Null without enough judged weeks. */
  atRecentRate: { hit: number; judged: number; target: number } | null;
}

const KIND: Record<GoalKey, SessionKind> = { endurance: "endurance", sweetSpot: "sweet_spot", threshold: "threshold", vo2: "vo2" };

/**
 * Hits and judged weeks per goal over the last `weeks` completed, non-recovery
 * weeks of a program state. A goal the plan didn't serve in a week isn't judged
 * that week, so it adds nothing to either count.
 */
export function recentRates(state: ProgramState, weeks = RECENT_WEEKS): RecentRates {
  const done = state.weeks.filter((w) => w.completed).slice(-weeks);
  const out: RecentRates = {};
  for (const w of done) {
    if (w.isRecovery) continue;
    for (const g of GOAL_KEYS) {
      const h = w.hit[g];
      if (h === undefined) continue;
      const r = (out[g] ??= { hit: 0, judged: 0 });
      r.judged++;
      if (h) r.hit++;
    }
  }
  return out;
}

/**
 * One entry per progress goal on the card. The target reaches
 * `start + stepMin x steps`, where `steps` is the number of non-recovery weeks
 * judged before the last week (recovery weeks don't step). At the recent rate
 * the steps are scaled by hit / judged and rounded down.
 */
export function forecastProgram(card: ProgramCard, recent: RecentRates): GoalForecast[] {
  const last = card.weeks[card.weeks.length - 1];
  if (!last) return [];
  const steps = card.weeks.slice(0, -1).filter((w) => !w.isRecovery).length;
  const out: GoalForecast[] = [];
  for (const key of GOAL_KEYS) {
    const g = card.program.goals[key];
    if (g.mode !== "progress") continue;
    const date = last.sessions.find((s) => s.kind === KIND[key])?.date ?? last.start;
    const rate = recent[key];
    const atRecentRate =
      rate && rate.judged >= MIN_JUDGED_WEEKS
        ? { hit: rate.hit, judged: rate.judged, target: g.start + g.stepMin * Math.floor((steps * rate.hit) / rate.judged) }
        : null;
    out.push({ key, start: g.start, stepMin: g.stepMin, ifAllHit: { date, target: g.start + g.stepMin * steps }, atRecentRate });
  }
  return out;
}
