import { and, eq, gte, lt, sql } from "drizzle-orm";
import { loginAttempts, waitlist, type Db } from "@sweetspot/db";
import type { LoginStore, WaitlistStore } from "./store";

export function pgLoginStore(db: Db): LoginStore {
  return {
    async recentFailures(windowMs) {
      const since = new Date(Date.now() - windowMs);
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(loginAttempts)
        .where(and(eq(loginAttempts.ok, false), gte(loginAttempts.at, since)));
      return row?.n ?? 0;
    },
    async record(ok) {
      await db.insert(loginAttempts).values({ ok });
      // Prune rows older than a day.
      await db.delete(loginAttempts).where(lt(loginAttempts.at, new Date(Date.now() - 86_400_000)));
    },
  };
}

export function pgWaitlistStore(db: Db): WaitlistStore {
  return {
    async add(email) {
      await db.insert(waitlist).values({ email }).onConflictDoNothing({ target: waitlist.email });
    },
    async recentCount(windowMs) {
      const since = new Date(Date.now() - windowMs);
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(waitlist).where(gte(waitlist.createdAt, since));
      return row?.n ?? 0;
    },
  };
}
