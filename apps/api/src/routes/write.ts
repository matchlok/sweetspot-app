import { Hono, type Context } from "hono";
import {
  GOAL_KEYS,
  MAX_LIFT_TARGET,
  denverToday,
  goalView,
  homeView,
  mondayOf,
  programView,
  sessionOptionsView,
  weekView,
  type DayOption,
  type GoalKey,
  type GoalMode,
  type OptionAction,
  type PlannedSession,
  type ViewData,
} from "@sweetspot/engine";
import { loadViewData, type DataDeps } from "../data";
import { fail } from "../errors";
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
  /** Null means cancel the instance. */
  to: string | null;
}

/** Turn a chosen option into calendar changes, from the plan as read just now. */
function changesFor(sessionId: string, action: OptionAction, option: DayOption, plan: readonly PlannedSession[]): CalendarChange[] | null {
  const byId = new Map(plan.map((p) => [p.id, p]));
  const main = byId.get(sessionId);
  if (!main) return null;
  const out: CalendarChange[] = [];

  if (action === "skip") {
    out.push({ sessionId, kind: main.kind, from: main.date, to: null });
  } else if (action === "move") {
    const to = option.id.slice("move:".length);
    if (!option.id.startsWith("move:") || !DAY.test(to)) return null;
    out.push({ sessionId, kind: main.kind, from: main.date, to });
  } else {
    const other = byId.get(option.id.slice("swap:".length));
    if (!option.id.startsWith("swap:") || !other) return null;
    out.push({ sessionId, kind: main.kind, from: main.date, to: other.date });
  }
  for (const m of option.alsoMoves) {
    const p = byId.get(m.sessionId);
    if (!p) return null;
    out.push({ sessionId: p.id, kind: p.kind, from: p.date, to: m.to });
  }
  // Sessions a cross-week move replaces are cancelled, last, so a failure above never leaves one cancelled.
  for (const a of option.absorbs ?? []) {
    const p = byId.get(a.sessionId);
    if (!p) return null;
    out.push({ sessionId: p.id, kind: p.kind, from: p.date, to: null });
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
    const done: CalendarChange[] = [];
    let error: string | null = null;
    let revertFailed = false;

    for (const ch of changes) {
      try {
        await data.sources.patchEvent(ch.sessionId, ch.to === null ? { status: "cancelled", tags: tags(ch.kind) } : { date: ch.to, tags: tags(ch.kind) });
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
          await data.sources.patchEvent(ch.sessionId, { date: ch.from });
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
    if (session.status === "skipped") return fail(c, 422, "blocked", "A skipped session stays skipped.");
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

  return r;
}
