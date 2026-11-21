import { and, eq, gte, lte, sql } from "drizzle-orm";
import { activities, decisions, goalChanges, liftTargets, manualDone, programSettings, syncState, type Db } from "@sweetspot/db";
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
    async saveGoalChange(c) {
      await db.insert(goalChanges).values({ goal: c.goal, effectiveWeek: c.effectiveWeek, mode: c.mode, targetMin: c.targetMin, stepMin: c.stepMin });
    },
    async saveLiftTargets(r) {
      await db
        .insert(liftTargets)
        .values(r)
        .onConflictDoUpdate({ target: liftTargets.effectiveWeek, set: { upper: r.upper, lower: r.lower } });
    },
    async markDone(r) {
      await db.insert(manualDone).values(r).onConflictDoNothing({ target: manualDone.sessionId });
    },
    async unmarkDone(sessionId) {
      const gone = await db.delete(manualDone).where(eq(manualDone.sessionId, sessionId)).returning({ id: manualDone.sessionId });
      return gone.length > 0;
    },
    async reserveDecisionId() {
      const res = (await db.execute(sql`select nextval(pg_get_serial_sequence('decisions', 'id')) as id`)) as unknown as
        | { rows: { id: string | number }[] }
        | { id: string | number }[];
      const rows = Array.isArray(res) ? res : res.rows;
      return Number(rows[0]!.id);
    },
    async logDecision(d) {
      await db.insert(decisions).values({
        id: d.id,
        trigger: d.trigger,
        inputs: d.inputs ?? {},
        options: d.options ?? null,
        ruleResults: d.ruleResults ?? null,
        choice: d.choice ?? null,
        calendarChanges: d.calendarChanges ?? null,
        status: d.status,
      });
    },
    async decisionsFor(trigger) {
      const rows = await db.select({ inputs: decisions.inputs, choice: decisions.choice }).from(decisions).where(eq(decisions.trigger, trigger)).orderBy(decisions.id);
      return rows;
    },
  };
}
