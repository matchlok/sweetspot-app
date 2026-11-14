import { boolean, date, index, integer, jsonb, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tables from docs/plans/API.md (Storage). Dates are `date` in America/Denver
 * (kept as "YYYY-MM-DD" strings, never shifted); timestamps are timestamptz.
 * Change only through migrations (`pnpm generate`, then `pnpm migrate`).
 */

/** One row per saved goal setting. The engine replays them in order, so a change never rewrites a judged week. */
export const goalChanges = pgTable(
  "goal_changes",
  {
    id: serial("id").primaryKey(),
    goal: text("goal", { enum: ["endurance", "sweetSpot", "threshold", "vo2"] }).notNull(),
    effectiveWeek: date("effective_week", { mode: "string" }).notNull(),
    mode: text("mode", { enum: ["progress", "hold", "off"] }).notNull(),
    targetMin: integer("target_min").notNull(),
    stepMin: integer("step_min").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("goal_changes_week_idx").on(t.effectiveWeek, t.id)],
);

/** Single row (id = 1). */
export const programSettings = pgTable("program_settings", {
  id: integer("id").primaryKey().default(1),
  startWeek: date("start_week", { mode: "string" }).notNull(),
  recoveryAfter: integer("recovery_after").notNull(),
  recoveryFactor: real("recovery_factor").notNull(),
});

/** No rows means 1 upper and 1 lower. */
export const liftTargets = pgTable("lift_targets", {
  effectiveWeek: date("effective_week", { mode: "string" }).primaryKey(),
  upper: integer("upper").notNull(),
  lower: integer("lower").notNull(),
});

/** A lift marked done without a recording. Deleted on undo. */
export const manualDone = pgTable("manual_done", {
  sessionId: text("session_id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  kind: text("kind").notNull(),
  markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
});

/** intervals.icu activities as fetched. Categories and zone minutes are recomputed from `raw`, never stored. */
export const activities = pgTable(
  "activities",
  {
    id: text("id").primaryKey(),
    date: date("date", { mode: "string" }).notNull(),
    type: text("type"),
    raw: jsonb("raw").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activities_date_idx").on(t.date)],
);

/** Single row (id = 1). */
export const syncState = pgTable("sync_state", {
  id: integer("id").primaryKey().default(1),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
});

/** Append-only log of every recommendation and change. Rows are never updated or deleted (the migration enforces it). */
export const decisions = pgTable("decisions", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  trigger: text("trigger").notNull(),
  inputs: jsonb("inputs").notNull(),
  options: jsonb("options"),
  ruleResults: jsonb("rule_results"),
  choice: jsonb("choice"),
  calendarChanges: jsonb("calendar_changes"),
  status: text("status", { enum: ["applied", "blocked", "failed"] }).notNull(),
});

/** For the 5-a-minute login limit. Prune rows older than a day. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    ok: boolean("ok").notNull(),
  },
  (t) => [index("login_attempts_at_idx").on(t.at)],
);

