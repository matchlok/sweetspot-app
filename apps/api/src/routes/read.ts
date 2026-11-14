import { Hono } from "hono";
import {
  GOAL_KEYS,
  goalPreview,
  goalView,
  homeView,
  programView,
  sessionOptionsView,
  weekView,
  type GoalDraft,
  type GoalKey,
  type GoalMode,
  type OptionAction,
} from "@sweetspot/engine";
import { loadViewData, syncActivities, syncIfStale, type DataDeps } from "../data";
import { fail } from "../errors";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s: string | undefined): s is string => !!s && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const isGoal = (s: string): s is GoalKey => (GOAL_KEYS as readonly string[]).includes(s);
const ACTIONS: readonly OptionAction[] = ["move", "swap", "skip"];
const MODES: readonly GoalMode[] = ["progress", "hold", "off"];

/** Read routes and sync. Each calls one view function from the engine on live data. */
export function readRoutes(data: DataDeps) {
  const r = new Hono();

  r.get("/home", async (c) => {
    const date = c.req.query("date");
    if (date !== undefined && !isDay(date)) return fail(c, 400, "invalid", "date must be YYYY-MM-DD.");
    await syncIfStale(data);
    return c.json(homeView(await loadViewData(data), date));
  });

  r.get("/week", async (c) => {
    const start = c.req.query("start");
    if (start !== undefined && !isDay(start)) return fail(c, 400, "invalid", "start must be YYYY-MM-DD.");
    await syncIfStale(data);
    return c.json(weekView(await loadViewData(data), start));
  });

  r.get("/sessions/:id/options", async (c) => {
    const action = c.req.query("action") as OptionAction;
    if (!ACTIONS.includes(action)) return fail(c, 400, "invalid", "action must be move, swap or skip.");
    const d = await loadViewData(data);
    if (!d.plans.some((p) => p.sessions.some((s) => s.id === c.req.param("id")))) {
      return fail(c, 404, "not_found", "No such session.");
    }
    return c.json(sessionOptionsView(d, c.req.param("id"), action));
  });

  r.get("/program", async (c) => c.json(programView(await loadViewData(data))));

  // Registered before /goals/:key so "preview" isn't read as a key.
  r.get("/goals/:key/preview", async (c) => {
    const key = c.req.param("key");
    if (!isGoal(key)) return fail(c, 404, "not_found", "No such goal.");
    const mode = c.req.query("mode") as GoalMode;
    const target = Number(c.req.query("target"));
    const stepMin = Number(c.req.query("stepMin"));
    if (!MODES.includes(mode) || !Number.isFinite(target) || target < 0 || !Number.isFinite(stepMin) || stepMin < 0) {
      return fail(c, 400, "invalid", "mode, target and stepMin are required.");
    }
    const draft: GoalDraft = { mode, target, stepMin };
    return c.json({ preview: goalPreview(await loadViewData(data), key, draft) });
  });

  r.get("/goals/:key", async (c) => {
    const key = c.req.param("key");
    if (!isGoal(key)) return fail(c, 404, "not_found", "No such goal.");
    return c.json(goalView(await loadViewData(data), key));
  });

  r.post("/sync", async (c) => c.json(await syncActivities(data)));

  return r;
}

/** Nightly job. Fetches new activities; marking unlogged sessions is derived at read time, so nothing else to write. */
export function cronRoutes(data: DataDeps) {
  const r = new Hono();
  r.get("/sync", async (c) => c.json(await syncActivities(data)));
  return r;
}
