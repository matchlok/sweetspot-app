import {
  DEFAULT_PROGRAM,
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
export async function loadViewData(d: DataDeps, today?: string): Promise<ViewData> {
  const now = (d.now ?? (() => new Date()))();
  const day = today ?? denverToday(now);
  const program = await loadProgram(d.repo);
  const thisMonday = mondayOf(day);
  const lastMonday = addDays(thisMonday, 7); // next week, for "what's coming" notes
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
