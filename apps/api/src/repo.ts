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
  /** Where it came from. Defaults to intervals.icu. */
  source: "intervals" | "strava";
  raw: IntervalsActivity;
}

export interface SyncState {
  lastSyncedAt: Date | null;
  lastError: string | null;
}

export type DecisionStatus = "applied" | "blocked" | "failed";

/** One decision-log entry. Append-only: the table has a trigger that refuses updates and deletes. */
export interface DecisionEntry {
  id: number;
  trigger: string;
  inputs: unknown;
  options?: unknown;
  ruleResults?: unknown;
  choice?: unknown;
  calendarChanges?: unknown;
  status: DecisionStatus;
}

export interface Repo {
  program(): Promise<StoredProgram | null>;
  goalChanges(): Promise<StoredGoalChange[]>;
  /** Rows as stored; the loader picks the one in force. */
  liftTargets(): Promise<{ effectiveWeek: string; upper: number; lower: number }[]>;
  manualDone(): Promise<{ sessionId: string; date: string; kind: string }[]>;
  activities(oldest: string, newest: string): Promise<StoredActivity[]>;
  upsertActivities(rows: StoredActivity[]): Promise<void>;
  /** Strava OAuth tokens, kept here because Strava rotates the refresh token. */
  stravaToken(): Promise<{ refreshToken: string; accessToken: string | null; expiresAt: Date | null } | null>;
  saveStravaToken(t: { refreshToken: string; accessToken: string | null; expiresAt: Date | null }): Promise<void>;
  syncState(): Promise<SyncState>;
  saveSyncState(s: SyncState): Promise<void>;
  /** Appends a goal_changes row. The engine replays rows in order, so a save never rewrites a judged week. */
  saveGoalChange(c: StoredGoalChange): Promise<void>;
  /** Insert or replace the row for `effectiveWeek`. */
  saveLiftTargets(r: { effectiveWeek: string; upper: number; lower: number }): Promise<void>;
  /** Idempotent. */
  markDone(r: { sessionId: string; date: string; kind: string }): Promise<void>;
  /** True if a row was removed. */
  unmarkDone(sessionId: string): Promise<boolean>;
  /** Reserved up front so calendar events can carry `sweetspotDecisionId` before the row exists. */
  reserveDecisionId(): Promise<number>;
  logDecision(d: DecisionEntry): Promise<void>;
  /** Logged entries for one trigger, oldest first. Readiness uses it to log once a day and to find unscored readings. */
  decisionsFor(trigger: string): Promise<{ inputs: unknown; choice: unknown }[]>;
}

export function toGoalChange(r: StoredGoalChange): GoalChange {
  return { effectiveWeek: r.effectiveWeek, goal: r.goal, change: { mode: r.mode, start: r.targetMin, stepMin: r.stepMin } };
}

type ManualRow = { sessionId: string; date: string; kind: string };
type LiftRow = { effectiveWeek: string; upper: number; lower: number };

export function memoryRepo(seed: Partial<{ program: StoredProgram; goalChanges: StoredGoalChange[]; manualDone: ManualRow[] }> = {}): Repo & {
  activitiesStore: Map<string, StoredActivity>;
  decisionLog: DecisionEntry[];
} {
  const store = new Map<string, StoredActivity>();
  const goals = [...(seed.goalChanges ?? [])];
  const manual = new Map((seed.manualDone ?? []).map((m) => [m.sessionId, m]));
  const lifts = new Map<string, LiftRow>();
  const decisionLog: DecisionEntry[] = [];
  let nextId = 1;
  let sync: SyncState = { lastSyncedAt: null, lastError: null };
  let strava: Awaited<ReturnType<Repo["stravaToken"]>> = null;
  return {
    activitiesStore: store,
    decisionLog,
    async program() {
      return seed.program ?? null;
    },
    async goalChanges() {
      return goals;
    },
    async liftTargets() {
      return [...lifts.values()].sort((a, b) => a.effectiveWeek.localeCompare(b.effectiveWeek));
    },
    async manualDone() {
      return [...manual.values()];
    },
    async activities(oldest, newest) {
      return [...store.values()].filter((a) => a.date >= oldest && a.date <= newest);
    },
    async upsertActivities(rows) {
      for (const r of rows) store.set(r.id, r);
    },
    async stravaToken() {
      return strava;
    },
    async saveStravaToken(t) {
      strava = t;
    },
    async syncState() {
      return sync;
    },
    async saveSyncState(s) {
      sync = s;
    },
    async saveGoalChange(c) {
      goals.push(c);
    },
    async saveLiftTargets(r) {
      lifts.set(r.effectiveWeek, r);
    },
    async markDone(r) {
      manual.set(r.sessionId, r);
    },
    async unmarkDone(id) {
      return manual.delete(id);
    },
    async reserveDecisionId() {
      return nextId++;
    },
    async logDecision(d) {
      decisionLog.push(d);
    },
    async decisionsFor(trigger) {
      return decisionLog.filter((d) => d.trigger === trigger).map((d) => ({ inputs: d.inputs, choice: d.choice }));
    },
  };
}
