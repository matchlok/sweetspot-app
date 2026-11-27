import { Hono, type Context } from "hono";
import {
  GOAL_KEYS,
  MAX_LIFT_TARGET,
  addDays,
  weekdayMon0,
  ORIGIN_TAG,
  denverToday,
  isOriginStandIn,
  goalView,
  homeView,
  mondayOf,
  planViolations,
  programView,
  sessionOptionsView,
  weekView,
  type DayOption,
  type GoalKey,
  type GoalMode,
  type OptionAction,
  type PlannedSession,
  type ViewData,
  type WeekSession,
} from "@sweetspot/engine";
import { writeWeek, type WriteWeekResult } from "../calendarWriter";
import { LIFT_TAG, loadViewData, type DataDeps } from "../data";
import { fail } from "../errors";
import { DraftError, buildDraft, loadHistory, parseDraftInput } from "../programDraft";
import type { DecisionEntry, DecisionStatus } from "../repo";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ACTIONS: readonly OptionAction[] = ["move", "swap", "skip"];
const MODES: readonly GoalMode[] = ["progress", "hold", "off"];
const isGoal = (s: string): s is GoalKey => (GOAL_KEYS as readonly string[]).includes(s);
const isInt = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

/** Bounds for a saved goal. Wide enough for any real plan, tight enough to catch a typo. */
const MAX_TARGET_MIN = 600;
const MAX_STEP_MIN = 60;

async function readBody(c: Context): Promise<Record<string, unknown> | null> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** One calendar change an option makes: move a session to a date, or cancel it (a skip). */
interface CalendarChange {
  sessionId: string;
  kind: string;
  from: string;
  /** The day the session was first planned for: kept across moves so a cross-week move stays readable. */
  origin: string;
  /** Null means cancel the instance. */
  to: string | null;
  /** The instance is cancelled (a skipped session). Moving it brings it back. */
  wasCancelled?: boolean;
}

/** Turn a chosen option into calendar changes, from the plan as read just now. */
function changesFor(sessionId: string, action: OptionAction, option: DayOption, plan: readonly PlannedSession[]): CalendarChange[] | null {
  const byId = new Map(plan.map((p) => [p.id, p]));
  const main = byId.get(sessionId);
  if (!main) return null;
  const out: CalendarChange[] = [];

  if (action === "skip") {
    out.push({ sessionId, kind: main.kind, from: main.date, origin: main.origin ?? main.date, to: null });
  } else if (action === "move") {
    const to = option.id.slice("move:".length);
    if (!option.id.startsWith("move:") || !DAY.test(to)) return null;
    out.push({ sessionId, kind: main.kind, from: main.date, origin: main.origin ?? main.date, to, ...(main.status === "skipped" ? { wasCancelled: true } : {}) });
  } else {
    const other = byId.get(option.id.slice("swap:".length));
    if (!option.id.startsWith("swap:") || !other) return null;
    out.push({ sessionId, kind: main.kind, from: main.date, origin: main.origin ?? main.date, to: other.date });
  }
  for (const m of option.alsoMoves) {
    const p = byId.get(m.sessionId);
    if (!p) return null;
    out.push({ sessionId: p.id, kind: p.kind, from: p.date, origin: p.origin ?? p.date, to: m.to });
  }
  // Sessions a cross-week move replaces are cancelled, last, so a failure above never leaves one cancelled.
  for (const a of option.absorbs ?? []) {
    const p = byId.get(a.sessionId);
    if (!p) return null;
    out.push({ sessionId: p.id, kind: p.kind, from: p.date, origin: p.origin ?? p.date, to: null });
  }
  return out;
}

/** Writes. Every one appends to the decision log (docs/plans/API.md, Writes). */
export function writeRoutes(data: DataDeps) {
  const r = new Hono();
  const now = () => (data.now ?? (() => new Date()))();
  const today = () => denverToday(now());

  /**
   * Append a decision row. Used after the effect has happened, so a logging
   * failure must not turn a change that applied into an error: it goes to the
   * server log with the full entry instead.
   */
  async function record(entry: DecisionEntry): Promise<void> {
    try {
      await data.repo.logDecision(entry);
    } catch (e) {
      console.error("decision log failed:", e instanceof Error ? e.message : e, JSON.stringify(entry));
    }
  }

  async function logSimple(trigger: string, inputs: unknown, choice: unknown, status: DecisionStatus = "applied") {
    await record({ id: await data.repo.reserveDecisionId(), trigger, inputs, choice, status });
  }

  const planOf = (d: ViewData, sessionId: string) => d.plans.find((p) => p.sessions.some((s) => s.id === sessionId));

  // ---- Move, swap, skip ----

  r.post("/sessions/:id/apply", async (c) => {
    const sessionId = c.req.param("id");
    const body = await readBody(c);
    const action = body?.action as OptionAction;
    const optionId = body?.optionId;
    const planVersion = body?.planVersion;
    if (!ACTIONS.includes(action) || typeof optionId !== "string" || typeof planVersion !== "string") {
      return fail(c, 400, "invalid", "action, optionId and planVersion are required.");
    }

    // Recompute from the calendar as it is now, never from what the client saw.
    const d = await loadViewData(data);
    const plan = planOf(d, sessionId);
    if (!plan) return fail(c, 404, "not_found", "No such session.");
    const view = sessionOptionsView(d, sessionId, action);
    if (view.planVersion !== planVersion) {
      return fail(c, 409, "conflict", "The plan changed since these options were computed. Reload them.");
    }

    const inputs = { sessionId, action, optionId, planVersion, today: d.today };
    const option = view.options.find((o) => o.id === optionId);
    const changes = option ? changesFor(sessionId, action, option, d.plans.flatMap((p) => p.sessions)) : null;
    if (!option || !changes) {
      const reason = view.blocked.find((b) => optionId.includes(b.heading))?.reason ?? "The rules don't offer that option.";
      await record({
        id: await data.repo.reserveDecisionId(),
        trigger: `apply_${action}`,
        inputs,
        options: view.options,
        choice: { optionId },
        status: "blocked",
      });
      return fail(c, 422, "blocked", reason);
    }

    const decisionId = await data.repo.reserveDecisionId();
    const tags = (kind: string) => ({ sweetspotKind: kind, sweetspotDecisionId: String(decisionId) });
    // A moved session also records the day it was planned for, so the reader can tell a move from a new session.
    const moveTags = (ch: CalendarChange) => ({ ...tags(ch.kind), [ORIGIN_TAG]: ch.origin });
    const done: CalendarChange[] = [];
    let error: string | null = null;
    let revertFailed = false;

    for (const ch of changes) {
      try {
        await data.sources.patchEvent(ch.sessionId, ch.to === null ? { status: "cancelled", tags: tags(ch.kind) } : { date: ch.to, ...(ch.wasCancelled ? { status: "confirmed" as const } : {}), tags: moveTags(ch) });
        done.push(ch);
      } catch (e) {
        error = e instanceof Error ? e.message : "calendar write failed";
        break;
      }
    }

    if (error !== null) {
      // Put back whatever already moved, so a swap never lands half done.
      for (const ch of [...done].reverse()) {
        if (ch.to === null) continue;
        try {
          await data.sources.patchEvent(ch.sessionId, { date: ch.from, ...(ch.wasCancelled ? { status: "cancelled" as const } : {}) });
        } catch {
          revertFailed = true;
        }
      }
      await record({
        id: decisionId,
        trigger: `apply_${action}`,
        inputs,
        options: view.options,
        ruleResults: option.rules,
        choice: { optionId, cta: option.cta },
        calendarChanges: { planned: changes, applied: done, error, revertFailed },
        status: "failed",
      });
      return fail(c, 502, "upstream", revertFailed ? "The calendar write failed and part of it could not be undone. Check the calendar." : "The calendar write failed. Nothing changed.");
    }

    await record({
      id: decisionId,
      trigger: `apply_${action}`,
      inputs,
      options: view.options,
      ruleResults: option.rules,
      choice: { optionId, cta: option.cta },
      calendarChanges: changes,
      status: "applied",
    });

    const fresh = await loadViewData(data);
    return c.json({ week: weekView(fresh, mondayOf(view.session.date)), home: homeView(fresh) });
  });

  // ---- Mark a lift done by hand ----

  r.post("/sessions/:id/done", async (c) => {
    const sessionId = c.req.param("id");
    const d = await loadViewData(data);
    const plan = planOf(d, sessionId);
    if (!plan) return fail(c, 404, "not_found", "No such session.");
    const { session } = sessionOptionsView(d, sessionId, "skip");

    if (session.kind !== "lift_upper" && session.kind !== "lift_lower") {
      return fail(c, 422, "blocked", "Only lifts can be marked done by hand. Rides come from intervals.icu.");
    }
    if (isOriginStandIn(sessionId)) return fail(c, 422, "blocked", "This session was moved to another day. Mark it done from there.");
    if (session.status === "done") {
      if (session.doneSource === "manual") return c.json({ home: homeView(d) }); // already marked: idempotent
      return fail(c, 409, "conflict", "This lift is already logged from a recording.");
    }
    if (session.date > d.today) return fail(c, 422, "blocked", "That lift is still ahead.");

    await data.repo.markDone({ sessionId, date: session.date, kind: session.kind });
    await logSimple("mark_done", { sessionId, date: session.date, kind: session.kind, today: d.today }, { doneSource: "manual" });
    return c.json({ home: homeView(await loadViewData(data)) });
  });

  r.delete("/sessions/:id/done", async (c) => {
    const sessionId = c.req.param("id");
    if (!(await data.repo.unmarkDone(sessionId))) return fail(c, 404, "not_found", "That session isn't marked done by hand.");
    await logSimple("unmark_done", { sessionId, today: today() }, { doneSource: null });
    return c.json({ home: homeView(await loadViewData(data)) });
  });

  // ---- Strength tags ----

  // Tag a strength activity upper or lower, or clear the tag with null. The latest tap wins.
  r.put("/lifts/:id/tag", async (c) => {
    const activityId = c.req.param("id");
    const body = await readBody(c);
    const tag = body?.tag;
    if (tag !== "upper" && tag !== "lower" && tag !== null) return fail(c, 400, "invalid", 'tag must be "upper", "lower" or null.');
    const d = await loadViewData(data);
    const lift = d.lifts.find((l) => l.id === activityId);
    if (!lift) return fail(c, 404, "not_found", "No such strength activity.");
    await logSimple(LIFT_TAG, { activityId, date: lift.date, today: d.today }, { tag });
    return c.json({ home: homeView(await loadViewData(data)) });
  });

  // ---- Settings ----

  r.put("/goals/:key", async (c) => {
    const key = c.req.param("key");
    if (!isGoal(key)) return fail(c, 404, "not_found", "No such goal.");
    const body = await readBody(c);
    const { mode, target, stepMin } = (body ?? {}) as Record<string, unknown>;
    if (!MODES.includes(mode as GoalMode) || !isInt(target, 1, MAX_TARGET_MIN) || !isInt(stepMin, 0, MAX_STEP_MIN)) {
      return fail(c, 400, "invalid", `mode, target (1 to ${MAX_TARGET_MIN}) and stepMin (0 to ${MAX_STEP_MIN}) are required.`);
    }
    // From the current week on. Earlier weeks keep the targets they were judged against.
    const effectiveWeek = mondayOf(today());
    await data.repo.saveGoalChange({ goal: key, effectiveWeek, mode: mode as GoalMode, targetMin: target, stepMin });
    await logSimple("set_goal", { goal: key, effectiveWeek }, { mode, target, stepMin });
    return c.json(goalView(await loadViewData(data), key));
  });

  r.put("/lifts", async (c) => {
    const body = await readBody(c);
    const { upper, lower } = (body ?? {}) as Record<string, unknown>;
    if (!isInt(upper, 0, MAX_LIFT_TARGET) || !isInt(lower, 0, MAX_LIFT_TARGET)) {
      return fail(c, 400, "invalid", `upper and lower must be whole numbers from 0 to ${MAX_LIFT_TARGET}.`);
    }
    const effectiveWeek = mondayOf(today());
    await data.repo.saveLiftTargets({ effectiveWeek, upper, lower });
    await logSimple("set_lifts", { effectiveWeek }, { upper, lower });
    return c.json(programView(await loadViewData(data)));
  });

  // ---- Program: draft and commit ----

  /** The plan's own rule gate over weeks 1 and 2 together, so Sunday into Monday is checked. */
  const blockRules = (weeks: { sessions: { id: string; date: string; kind: WeekSession["kind"]; title: string; minutes: number }[] }[]) =>
    planViolations(weeks.flatMap((w) => w.sessions.map((s): WeekSession => ({ ...s, status: "planned" }))));

  /** Computes and writes nothing: no Neon, no calendar, no decision row. */
  r.post("/program/draft", async (c) => {
    try {
      const input = parseDraftInput(await readBody(c));
      const history = await loadHistory(data, today());
      return c.json(await buildDraft(data, input, history));
    } catch (e) {
      if (e instanceof DraftError) return fail(c, e.status, e.code, e.message);
      throw e;
    }
  });

  r.post("/program/commit", async (c) => {
    const body = await readBody(c);
    let input;
    try {
      input = parseDraftInput(body);
    } catch (e) {
      if (e instanceof DraftError) return fail(c, e.status, e.code, e.message);
      throw e;
    }
    if (typeof body?.draftVersion !== "string" || body.draftVersion === "") return fail(c, 400, "invalid", "draftVersion is required.");
    const draftVersion = body.draftVersion;

    const asOf = today();
    const history = await loadHistory(data, asOf);
    const decisionId = await data.repo.reserveDecisionId();
    const inputs = { asOf, history, availability: input.availability, purpose: input.purpose, draftVersion };
    const refuse = (reason: string) => record({ id: decisionId, trigger: "program_commit", inputs, choice: { reason }, status: "blocked" });

    // Regenerate from the server's own data; the client's card is never trusted.
    let draft;
    try {
      draft = await buildDraft(data, input, history);
    } catch (e) {
      if (!(e instanceof DraftError)) throw e;
      if (e.code === "blocked") await refuse(e.message);
      return fail(c, e.status, e.code, e.message);
    }
    if (draft.draftVersion !== draftVersion) {
      await refuse("stale draftVersion");
      return fail(c, 409, "conflict", "The program changed since this draft was made. Draft it again.");
    }

    const { card } = draft;
    const blockStart = card.program.startWeek;
    const weeks = card.weeks.slice(0, 2).map((w) => ({ oldest: w.start, newest: addDays(w.start, 6) }));
    const failedEntry = (error: string, extra: Record<string, unknown> = {}): DecisionEntry => ({
      id: decisionId,
      trigger: "program_commit",
      inputs,
      choice: { error },
      calendarChanges: extra,
      status: "failed",
    });
    if (!data.sources.createEvent || !data.sources.deleteEvent) {
      await record(failedEntry("Calendar writer is not configured"));
      return fail(c, 502, "upstream", "The calendar writer is not configured. Nothing changed.");
    }

    // (a) archive the old program and drop its planned sessions from the block start on; (b) create the new one.
    // A retry of a draft whose program is already active skips both.
    let programId: number;
    let archivedProgramId: number | null = null;
    try {
      const active = await data.repo.activeProgram();
      const retry = active !== null && (active.card as { draftVersion?: unknown } | null)?.draftVersion === draftVersion;
      if (active && retry) {
        programId = active.id;
      } else {
        if (active) {
          const stale = await data.repo.plannedSessions(blockStart, "9999-12-31");
          await data.repo.archiveProgram(active.id);
          for (const s of stale) await data.repo.deletePlannedSession(s.id);
          archivedProgramId = active.id;
        }
        const made = await data.repo.createProgram(
          {
            purpose: input.purpose.kind,
            raceDate: input.purpose.raceDate ?? null,
            blockWeeks: card.blockWeeks,
            availability: input.availability,
            card: { ...card, draftVersion, forecast: draft.forecast },
          },
          card.weeks.flatMap((w) => w.sessions.map((s) => ({ date: s.date, kind: s.kind, minutes: s.minutes, title: s.title }))),
        );
        programId = made.program.id;
      }
    } catch (e) {
      await record(failedEntry(e instanceof Error ? e.message : "saving the program failed", { archivedProgramId }));
      return fail(c, 502, "upstream", "The program could not be saved. Retry.");
    }

    // (c) write block weeks 1 and 2 to the calendar. A failure doesn't stop (d): the program is saved either way.
    const written: WriteWeekResult[] = [];
    let calendarError: string | null = null;
    try {
      for (const w of weeks) written.push(await writeWeek(data, w, await data.repo.plannedSessions(w.oldest, w.newest)));
    } catch (e) {
      calendarError = e instanceof Error ? e.message : "calendar write failed";
    }

    // (d) goal changes at block week 1 (every goal, so modes carry) and lift targets from what the generator placed.
    let goalsError: string | null = null;
    try {
      const have = await data.repo.goalChanges();
      for (const key of GOAL_KEYS) {
        const g = card.program.goals[key];
        const last = have.filter((x) => x.goal === key && x.effectiveWeek === blockStart).at(-1);
        if (last && last.mode === g.mode && last.targetMin === g.start && last.stepMin === g.stepMin) continue; // a retry
        await data.repo.saveGoalChange({ goal: key, effectiveWeek: blockStart, mode: g.mode, targetMin: g.start, stepMin: g.stepMin });
      }
      const week1 = card.weeks[0]!.sessions;
      await data.repo.saveLiftTargets({
        effectiveWeek: blockStart,
        upper: week1.filter((s) => s.kind === "lift_upper").length,
        lower: week1.filter((s) => s.kind === "lift_lower").length,
      });
    } catch (e) {
      goalsError = e instanceof Error ? e.message : "saving goals failed";
    }

    // (e) the decision log.
    const template = (card.weeks.find((w) => !w.isRecovery) ?? card.weeks[0]!).sessions.map((s) => ({ weekday: weekdayMon0(s.date), kind: s.kind, minutes: s.minutes }));
    const error = calendarError ?? goalsError;
    await record({
      id: decisionId,
      trigger: "program_commit",
      inputs,
      ruleResults: { planViolations: blockRules(card.weeks.slice(0, 2)) },
      choice: { programId, blockWeeks: card.blockWeeks, goals: card.program.goals, weeklyTemplate: template, assumptions: card.assumptions, forecast: draft.forecast },
      calendarChanges: {
        weeks: written.map(({ oldest, newest, deleted, created }) => ({ oldest, newest, deleted, created })),
        archivedProgramId,
        ...(error ? { error } : {}),
      },
      status: error ? "failed" : "applied",
    });
    if (calendarError) return fail(c, 502, "upstream", "Program saved; calendar not fully written. Retry.");
    if (goalsError) return fail(c, 502, "upstream", "Program saved; goals not fully saved. Retry.");

    const fresh = await loadViewData(data, undefined, blockStart);
    return c.json({ programId, written, week: weekView(fresh, blockStart) });
  });

  return r;
}
