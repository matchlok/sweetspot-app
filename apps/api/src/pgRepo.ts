import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { activities, decisions, goalChanges, liftTargets, manualDone, plannedSessions, programs, programSettings, sourceTokens, syncState, type Db } from "@sweetspot/db";
import type { IntervalsActivity } from "@sweetspot/engine";
import type { PlannedSession, Repo } from "./repo";

function toPlanned(r: typeof plannedSessions.$inferSelect): PlannedSession {
  return { id: r.id, programId: r.programId, date: r.date, kind: r.kind, minutes: r.minutes, title: r.title, calendarEventId: r.calendarEventId, status: r.status };
}

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
      return rows.map((r) => ({ id: r.id, date: r.date, type: r.type, source: r.source, raw: r.raw as IntervalsActivity }));
    },
    async upsertActivities(rows) {
      // Chunked so a first backfill stays under parameter limits.
      for (let i = 0; i < rows.length; i += 100) {
        await db
          .insert(activities)
          .values(rows.slice(i, i + 100).map((r) => ({ id: r.id, date: r.date, type: r.type, source: r.source, raw: r.raw })))
          .onConflictDoUpdate({
            target: activities.id,
            set: { date: sql`excluded.date`, type: sql`excluded.type`, source: sql`excluded.source`, raw: sql`excluded.raw`, fetchedAt: sql`now()` },
          });
      }
    },
    async stravaToken() {
      const [r] = await db.select().from(sourceTokens).where(eq(sourceTokens.source, "strava")).limit(1);
      return r ? { refreshToken: r.refreshToken, accessToken: r.accessToken, expiresAt: r.expiresAt } : null;
    },
    async saveStravaToken(t) {
      await db
        .insert(sourceTokens)
        .values({ source: "strava", refreshToken: t.refreshToken, accessToken: t.accessToken, expiresAt: t.expiresAt })
        .onConflictDoUpdate({
          target: sourceTokens.source,
          set: { refreshToken: t.refreshToken, accessToken: t.accessToken, expiresAt: t.expiresAt, updatedAt: sql`now()` },
        });
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
    async createProgram(p, sessions = []) {
      const [row] = await db
        .insert(programs)
        .values({ purpose: p.purpose, raceDate: p.raceDate, blockWeeks: p.blockWeeks, availability: p.availability ?? {}, card: p.card ?? {} })
        .returning();
      const program = { id: row!.id, purpose: row!.purpose, raceDate: row!.raceDate, blockWeeks: row!.blockWeeks, availability: row!.availability, card: row!.card, status: row!.status };
      const made: PlannedSession[] = [];
      try {
        for (let i = 0; i < sessions.length; i += 100) {
          const rows = await db
            .insert(plannedSessions)
            .values(sessions.slice(i, i + 100).map((s) => ({ programId: program.id, date: s.date, kind: s.kind, minutes: s.minutes, title: s.title ?? null })))
            .returning();
          made.push(...rows.map(toPlanned));
        }
      } catch (err) {
        // neon-http has no transactions, so undo by hand: deleting the program cascades to any sessions already written.
        await db.delete(programs).where(eq(programs.id, program.id));
        throw err;
      }
      return { program, sessions: made };
    },
    async activeProgram() {
      const [r] = await db.select().from(programs).where(eq(programs.status, "active")).orderBy(desc(programs.id)).limit(1);
      return r ? { id: r.id, purpose: r.purpose, raceDate: r.raceDate, blockWeeks: r.blockWeeks, availability: r.availability, card: r.card, status: r.status } : null;
    },
    async archiveProgram(id) {
      await db.update(programs).set({ status: "archived" }).where(eq(programs.id, id));
    },
    async plannedSessions(oldest, newest) {
      const rows = await db
        .select({ s: plannedSessions })
        .from(plannedSessions)
        .innerJoin(programs, eq(plannedSessions.programId, programs.id))
        .where(and(gte(plannedSessions.date, oldest), lte(plannedSessions.date, newest), eq(programs.status, "active")))
        .orderBy(plannedSessions.date, plannedSessions.id);
      return rows.map((r) => toPlanned(r.s));
    },
    async updatePlannedSession(id, patch) {
      // Drop undefined keys: Drizzle ignores them, so a patch of only undefined values has nothing to set.
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length === 0) {
        const [r] = await db.select().from(plannedSessions).where(eq(plannedSessions.id, id)).limit(1);
        return r ? toPlanned(r) : null;
      }
      const [r] = await db.update(plannedSessions).set(clean).where(eq(plannedSessions.id, id)).returning();
      return r ? toPlanned(r) : null;
    },
    async deletePlannedSession(id) {
      const gone = await db.delete(plannedSessions).where(eq(plannedSessions.id, id)).returning({ id: plannedSessions.id });
      return gone.length > 0;
    },
  };
}
