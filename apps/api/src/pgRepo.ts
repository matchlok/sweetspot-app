import { and, gte, lte, sql } from "drizzle-orm";
import { activities, goalChanges, liftTargets, manualDone, programSettings, syncState, type Db } from "@sweetspot/db";
import type { IntervalsActivity } from "@sweetspot/engine";
import type { Repo } from "./repo";

export function pgRepo(db: Db): Repo {
  return {
    async program() {
      const [r] = await db.select().from(programSettings).limit(1);
      return r ? { startWeek: r.startWeek, recoveryAfter: r.recoveryAfter, recoveryFactor: r.recoveryFactor } : null;
    },
    async goalChanges() {
      const rows = await db.select().from(goalChanges).orderBy(goalChanges.effectiveWeek, goalChanges.id);
      return rows.map((r) => ({ goal: r.goal, effectiveWeek: r.effectiveWeek, mode: r.mode, targetMin: r.targetMin, stepMin: r.stepMin }));
    },
    async liftTargets() {
      return db.select().from(liftTargets).orderBy(liftTargets.effectiveWeek);
    },
    async manualDone() {
      const rows = await db.select().from(manualDone);
      return rows.map((r) => ({ sessionId: r.sessionId, date: r.date, kind: r.kind }));
    },
    async activities(oldest, newest) {
      const rows = await db
        .select()
        .from(activities)
        .where(and(gte(activities.date, oldest), lte(activities.date, newest)));
      return rows.map((r) => ({ id: r.id, date: r.date, type: r.type, raw: r.raw as IntervalsActivity }));
    },
    async upsertActivities(rows) {
      // Chunked so a first backfill stays under parameter limits.
      for (let i = 0; i < rows.length; i += 100) {
        await db
          .insert(activities)
          .values(rows.slice(i, i + 100).map((r) => ({ id: r.id, date: r.date, type: r.type, raw: r.raw })))
          .onConflictDoUpdate({
            target: activities.id,
            set: { date: sql`excluded.date`, type: sql`excluded.type`, raw: sql`excluded.raw`, fetchedAt: sql`now()` },
          });
      }
    },
    async syncState() {
      const [r] = await db.select().from(syncState).limit(1);
      return { lastSyncedAt: r?.lastSyncedAt ?? null, lastError: r?.lastError ?? null };
    },
    async saveSyncState(s) {
      await db
        .insert(syncState)
        .values({ id: 1, lastSyncedAt: s.lastSyncedAt, lastError: s.lastError })
        .onConflictDoUpdate({ target: syncState.id, set: { lastSyncedAt: s.lastSyncedAt, lastError: s.lastError } });
    },
  };
}
