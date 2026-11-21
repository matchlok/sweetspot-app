import {
  DEFAULT_PROGRAM,
  addDays,
  denverToday,
  mapActivities,
  mapLifts,
  RIDE_TYPES,
  mondayOf,
  readWeek,
  type Program,
  type ViewData,
  type WeekPlan,
} from "@sweetspot/engine";
import { DEFAULT_ROUTING, selectActivities, type ActivityRouting } from "./routing";
import { toGoalChange, type Repo, type StoredActivity } from "./repo";
import type { Sources } from "./sources";

export interface DataDeps {
  repo: Repo;
  sources: Sources;
  /** Injected so tests control the clock. */
  now?: () => Date;
  /** Which source supplies which activity types. Defaults to intervals.icu for all, Strava for strength. */
  routing?: ActivityRouting;
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
    const stored = await d.repo.activities(oldest, today);
    const existing = new Set(stored.map((a) => a.id));
    const toRows = (list: typeof raw, source: StoredActivity["source"]): StoredActivity[] =>
      list.flatMap((a) => {
        const date = a.start_date_local?.slice(0, 10);
        if (a.id === undefined || !date) return [];
        return [{ id: String(a.id), date, type: a.type ?? null, source, raw: a }];
      });
    const rows = toRows(raw, "intervals");
    // Strava is a second feed. If it fails, intervals.icu data still lands and the error is recorded, not thrown.
    let stravaError: string | null = null;
    if (d.sources.stravaActivities) {
      try {
        const stravaRows = toRows(await d.sources.stravaActivities(oldest, today), "strava");
        const have = new Map(stored.map((a) => [a.id, a.raw]));
        for (const r of stravaRows) {
          const kept = have.get(r.id);
          if (kept?.icu_zone_times) {
            // Computed once; the stream is one API call per ride and zones don't change after the fact.
            r.raw = { ...r.raw, icu_zone_times: kept.icu_zone_times, device_watts: kept.device_watts ?? true };
          } else if (d.sources.stravaPowerZones && r.type && RIDE_TYPES.has(r.type) && r.raw.device_watts !== false) {
            const z = await d.sources.stravaPowerZones(r.id);
            // Strava ride zones are computed from the power stream with intervals.icu's FTP. No stream: stays unknown.
            if (z) r.raw = { ...r.raw, device_watts: true, icu_zone_times: [...z.power.map((secs, i) => ({ id: `Z${i + 1}`, secs })), { id: "SS", secs: z.sweetSpotSeconds }] };
          }
        }
        rows.push(...stravaRows);
      } catch (e) {
        stravaError = `strava: ${e instanceof Error ? e.message : "sync failed"}`;
      }
    }
    await d.repo.upsertActivities(rows);
    await d.repo.saveSyncState({ lastSyncedAt: now, lastError: stravaError });
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
  const raws = selectActivities(stored, d.routing ?? DEFAULT_ROUTING).map((s) => s.raw);

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
