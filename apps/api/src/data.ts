import {
  DEFAULT_PROGRAM,
  homeView,
  readinessOutcome,
  readinessPrediction,
  scoreReading,
  READINESS_VERSION,
  type ReadinessPrediction,
  addDays,
  denverToday,
  mapActivities,
  mapLifts,
  mondayOf,
  readWeek,
  type Program,
  type ViewData,
  type WeekPlan,
} from "@sweetspot/engine";
import { toGoalChange, type Repo } from "./repo";
import type { Sources } from "./sources";

export interface DataDeps {
  repo: Repo;
  sources: Sources;
  /** Injected so tests control the clock. */
  now?: () => Date;
}

const STALE_MS = 15 * 60_000;

export interface SyncResult {
  lastSyncedAt: string;
  newActivities: number;
}

/**
 * Fetch activities from intervals.icu into `activities`. The first sync
 * backfills from the program start; later ones re-read the last 14 days, which
 * catches edits to recent rides. Ids make the insert idempotent.
 */
export async function syncActivities(d: DataDeps): Promise<SyncResult> {
  const now = (d.now ?? (() => new Date()))();
  const today = denverToday(now);
  const program = await loadProgram(d.repo);
  const state = await d.repo.syncState();
  const oldest = state.lastSyncedAt ? addDays(today, -14) : program.startWeek;
  try {
    const raw = await d.sources.activities(oldest, today);
    const existing = new Set((await d.repo.activities(oldest, today)).map((a) => a.id));
    const rows = raw.flatMap((a) => {
      const date = a.start_date_local?.slice(0, 10);
      if (a.id === undefined || !date) return [];
      return [{ id: String(a.id), date, type: a.type ?? null, raw: a }];
    });
    await d.repo.upsertActivities(rows);
    await d.repo.saveSyncState({ lastSyncedAt: now, lastError: null });
    // Scoring must never fail a sync that worked.
    await scoreReadiness(d).catch((e) => console.error("readiness scoring failed:", e instanceof Error ? e.message : e));
    return { lastSyncedAt: now.toISOString(), newActivities: rows.filter((r) => !existing.has(r.id)).length };
  } catch (e) {
    await d.repo.saveSyncState({ lastSyncedAt: state.lastSyncedAt, lastError: e instanceof Error ? e.message : "sync failed" });
    throw e;
  }
}

export async function syncIfStale(d: DataDeps): Promise<void> {
  const now = (d.now ?? (() => new Date()))();
  const { lastSyncedAt } = await d.repo.syncState();
  if (!lastSyncedAt || now.getTime() - lastSyncedAt.getTime() > STALE_MS) await syncActivities(d);
}

async function loadProgram(repo: Repo): Promise<Program> {
  const p = await repo.program();
  return p ? { ...DEFAULT_PROGRAM, ...p } : DEFAULT_PROGRAM;
}

/** Monday of every week from `from` through `to`. */
function mondays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = mondayOf(from); m <= to; m = addDays(m, 7)) out.push(m);
  return out;
}

/** Build the engine's ViewData from stored activities, the calendar and stored settings. */
export async function loadViewData(d: DataDeps, today?: string, horizon?: string): Promise<ViewData> {
  const now = (d.now ?? (() => new Date()))();
  const day = today ?? denverToday(now);
  const program = await loadProgram(d.repo);
  const thisMonday = mondayOf(day);
  // Next week at least, for "what's coming" notes; further out when a screen asks for it (week and month views).
  const nextMonday = addDays(thisMonday, 7);
  const lastMonday = horizon && mondayOf(horizon) > nextMonday ? mondayOf(horizon) : nextMonday;
  const last = addDays(lastMonday, 6);

  const [events, stored, goalRows, liftRows, manual, state, wellness] = await Promise.all([
    d.sources.events(program.startWeek, last),
    d.repo.activities(program.startWeek, day),
    d.repo.goalChanges(),
    d.repo.liftTargets(),
    d.repo.manualDone(),
    d.repo.syncState(),
    d.sources.wellness(addDays(day, -42), day).catch(() => []),
  ]);

  const plans: WeekPlan[] = mondays(program.startWeek, lastMonday).map((m) => readWeek(events, m));
  const raws = stored.map((s) => s.raw);

  // Lift targets are one undated setting for now (STATUS): use the row in force this week.
  const inForce = liftRows.filter((r) => r.effectiveWeek <= thisMonday).at(-1);

  return {
    today: day,
    now,
    program,
    changes: goalRows.map(toGoalChange),
    liftTargets: inForce ? { upper: inForce.upper, lower: inForce.lower } : undefined,
    plans,
    rides: mapActivities(raws),
    lifts: mapLifts(raws),
    manualDone: manual,
    wellness,
    lastSyncedAt: (state.lastSyncedAt ?? now).toISOString(),
  };
}

// ---- Readiness log ----

const READING = "readiness_reading";
const SCORED = "readiness_scored";
const dateOf = (x: unknown): string | null => {
  const v = (x as { date?: unknown } | null)?.date;
  return typeof v === "string" ? v : null;
};

/**
 * Log today's readiness reading with its prediction, once per day, the first
 * time Home is read (AGENTS.md rule 2: every recommendation is logged with
 * its inputs and a prediction, then scored). Returns the prediction logged,
 * or null when there is no reading or one is already logged for the date.
 */
export async function logReadiness(d: DataDeps, view: ViewData): Promise<ReadinessPrediction | null> {
  const prediction = readinessPrediction(view);
  if (!prediction) return null;
  const done = new Set((await d.repo.decisionsFor(READING)).map((r) => dateOf(r.inputs)));
  if (done.has(prediction.date)) return null;
  const home = homeView(view);
  await d.repo.logDecision({
    id: await d.repo.reserveDecisionId(),
    trigger: READING,
    inputs: { date: prediction.date, version: READINESS_VERSION, readiness: home.readiness, fatigue: home.fatigue },
    choice: prediction,
    status: "applied",
  });
  return prediction;
}

/** Score logged readings whose day is over. Appends a `readiness_scored` entry per reading, once. */
export async function scoreReadiness(d: DataDeps): Promise<number> {
  const readings = await d.repo.decisionsFor(READING);
  if (readings.length === 0) return 0;
  const scored = new Set((await d.repo.decisionsFor(SCORED)).map((r) => dateOf(r.inputs)));
  const now = (d.now ?? (() => new Date()))();
  const today = denverToday(now);
  const due = readings.filter((r) => {
    const date = dateOf(r.inputs);
    return date !== null && date < today && !scored.has(date);
  });
  if (due.length === 0) return 0;

  const view = await loadViewData(d);
  let n = 0;
  for (const r of due) {
    const p = r.choice as ReadinessPrediction;
    const outcome = readinessOutcome(view, p);
    if (!outcome) continue; // no session that day, or its goal wasn't judged: nothing to score against
    await d.repo.logDecision({
      id: await d.repo.reserveDecisionId(),
      trigger: SCORED,
      inputs: { date: p.date, prediction: p },
      choice: { outcome, score: scoreReading(p, outcome) },
      status: "applied",
    });
    n++;
  }
  return n;
}
