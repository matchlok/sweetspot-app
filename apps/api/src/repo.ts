import type { GoalChange, GoalKey, GoalMode, IntervalsActivity } from "@sweetspot/engine";

/** Stored state the loaders need. A Postgres version is in pgRepo.ts; tests use the in-memory one. */

export interface StoredProgram {
  startWeek: string;
  recoveryAfter: number;
  recoveryFactor: number;
}

export interface StoredGoalChange {
  goal: GoalKey;
  effectiveWeek: string;
  mode: GoalMode;
  targetMin: number;
  stepMin: number;
}

export interface StoredActivity {
  id: string;
  date: string;
  type: string | null;
  raw: IntervalsActivity;
}

export interface SyncState {
  lastSyncedAt: Date | null;
  lastError: string | null;
}

export interface Repo {
  program(): Promise<StoredProgram | null>;
  goalChanges(): Promise<StoredGoalChange[]>;
  /** Rows as stored; the loader picks the one in force. */
  liftTargets(): Promise<{ effectiveWeek: string; upper: number; lower: number }[]>;
  manualDone(): Promise<{ sessionId: string; date: string; kind: string }[]>;
  activities(oldest: string, newest: string): Promise<StoredActivity[]>;
  upsertActivities(rows: StoredActivity[]): Promise<void>;
  syncState(): Promise<SyncState>;
  saveSyncState(s: SyncState): Promise<void>;
}

export function toGoalChange(r: StoredGoalChange): GoalChange {
  return { effectiveWeek: r.effectiveWeek, goal: r.goal, change: { mode: r.mode, start: r.targetMin, stepMin: r.stepMin } };
}

export function memoryRepo(seed: Partial<{ program: StoredProgram; goalChanges: StoredGoalChange[]; manualDone: { sessionId: string; date: string; kind: string }[] }> = {}): Repo & { activitiesStore: Map<string, StoredActivity> } {
  const store = new Map<string, StoredActivity>();
  let sync: SyncState = { lastSyncedAt: null, lastError: null };
  return {
    activitiesStore: store,
    async program() {
      return seed.program ?? null;
    },
    async goalChanges() {
      return seed.goalChanges ?? [];
    },
    async liftTargets() {
      return [];
    },
    async manualDone() {
      return seed.manualDone ?? [];
    },
    async activities(oldest, newest) {
      return [...store.values()].filter((a) => a.date >= oldest && a.date <= newest);
    },
    async upsertActivities(rows) {
      for (const r of rows) store.set(r.id, r);
    },
    async syncState() {
      return sync;
    },
    async saveSyncState(s) {
      sync = s;
    },
  };
}
