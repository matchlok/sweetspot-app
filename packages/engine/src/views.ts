import { addDays, mondayOf, weekdayMon0 } from "./dates";
import type { SessionKind, WeekPlan, PlannedSession } from "./calendar";
import { fatigueOn, type WellnessRow } from "./fatigue";
import { toActivityZones, type RideZones } from "./intervals";
import {
  LIFT_KEYS,
  goalServedBy,
  liftCounts,
  matchLifts,
  plannedGoals,
  sessionStatus,
  type LiftActivity,
  type LiftKey,
  type ResolvedStatus,
} from "./plan";
import { weeklyZoneRows } from "./scorecard";
import {
  GOAL_KEYS,
  programState,
  type GoalChange,
  type GoalConfig,
  type GoalKey,
  type GoalMinutes,
  type GoalMode,
  type Program,
  type ProgramState,
} from "./targets";
import { dayOptions, type DayOptions, type OptionAction, type WeekSession } from "./options";

/**
 * View models: one pure function per read endpoint in docs/plans/API.md. They
 * take fetched data and stored state as arguments and return exactly what a
 * screen shows. No training math lives in the web app (AGENTS.md rule 1), and
 * nothing here reads the clock: `today` and `now` come in.
 */

// ---- Shared types ----

export type Day = string;
export type SessionStatus = ResolvedStatus;

export interface Session {
  id: string;
  date: Day;
  kind: SessionKind;
  title: string;
  minutes: number | null;
  /** Null until the plan carries a description; never invented. */
  detail: string | null;
  status: SessionStatus;
  doneSource?: "intervals" | "manual";
}

export interface GoalBar {
  key: GoalKey | LiftKey;
  label: string;
  unit: "min" | "sessions";
  actual: number;
  target: number;
  hit: boolean;
  nudge?: { text: string; date: Day; sessionId: string };
}

export interface OffGoal {
  key: GoalKey;
  label: string;
  text: string;
}

// ---- Input ----

export interface ViewData {
  /** Today's Denver date. */
  today: Day;
  /** The instant used for the "not logged after 21:00" guard. Defaults to noon on `today`, which never trips it. */
  now?: Date;
  program: Program;
  changes?: readonly GoalChange[];
  /** Lift sessions per week, 0 to 7 each. Defaults to 1 and 1. Not dated yet: one setting applies to every week. */
  liftTargets?: Record<LiftKey, number>;
  /** Plans read from the calendar. A week missing here counts as everything planned for goals, and has no sessions. */
  plans: readonly WeekPlan[];
  rides: readonly RideZones[];
  lifts: readonly LiftActivity[];
  /** Sessions marked done by hand. */
  manualDone?: readonly { sessionId: string }[];
  wellness?: readonly WellnessRow[];
  lastSyncedAt: string;
}

// ---- Labels and formatting ----

const GOAL_LABEL: Record<GoalKey, string> = {
  endurance: "Endurance",
  sweetSpot: "Sweet spot",
  threshold: "Threshold",
  vo2: "VO2",
};
const GOAL_DEFINITION: Record<GoalKey, string> = {
  endurance: "Time in Z2 and Z3",
  sweetSpot: "Time at 88 to 94% of FTP, power rides only",
  threshold: "Time in Z4",
  vo2: "Time in Z5",
};
const LIFT_LABEL: Record<LiftKey, string> = { upper: "Upper lift", lower: "Lower lift" };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayName = (d: Day) => DAYS[weekdayMon0(d)]!;
const dayAbbr = (d: Day) => dayName(d).slice(0, 3);
const monthDay = (d: Day) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

function weekLabel(start: Day): string {
  const end = addDays(start, 6);
  return start.slice(5, 7) === end.slice(5, 7)
    ? `${monthDay(start)} to ${Number(end.slice(8, 10))}`
    : `${monthDay(start)} to ${monthDay(end)}`;
}

const weeksBetween = (a: Day, b: Day) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / (7 * 86_400_000));

// ---- Shared computation ----

const liftOf = (k: SessionKind): LiftKey | null => (k === "lift_upper" ? "upper" : k === "lift_lower" ? "lower" : null);
const planFor = (d: ViewData, weekStart: Day) => d.plans.find((p) => p.weekStart === weekStart);

function plannedMap(d: ViewData): Map<string, Set<GoalKey>> {
  return new Map(d.plans.map((p) => [p.weekStart, plannedGoals(p.sessions)]));
}

/** Zone minutes per goal for each week from the program start through `weekStart`. */
function actualsThrough(d: ViewData, weekStart: Day): Map<string, Partial<GoalMinutes>> {
  const n = weeksBetween(d.program.startWeek, weekStart);
  const out = new Map<string, Partial<GoalMinutes>>();
  if (n < 0) return out;
  for (const w of weeklyZoneRows(toActivityZones(d.rides), weekStart, n + 1)) {
    out.set(w.start, {
      endurance: w.enduranceSeconds / 60,
      sweetSpot: w.ssSeconds / 60,
      threshold: w.z4 / 60,
      vo2: w.vo2Seconds / 60,
    });
  }
  return out;
}

function stateFor(d: ViewData, weekStart: Day, extra: readonly GoalChange[] = []): ProgramState {
  return programState(d.program, actualsThrough(d, weekStart), weekStart, {
    planned: plannedMap(d),
    changes: [...(d.changes ?? []), ...extra],
  });
}

/** Goal configs in force in `weekStart`, after dated changes. */
function configsAt(d: ViewData, weekStart: Day, extra: readonly GoalChange[] = []): Record<GoalKey, GoalConfig> {
  const out = { ...d.program.goals };
  const all = [...(d.changes ?? []), ...extra].filter((c) => c.effectiveWeek <= weekStart);
  all.sort((a, b) => a.effectiveWeek.localeCompare(b.effectiveWeek));
  for (const c of all) out[c.goal] = { ...out[c.goal], ...c.change };
  return out;
}

interface ResolvedWeek {
  start: Day;
  sessions: Session[];
  weekSessions: WeekSession[];
  plan: WeekPlan | undefined;
  /** Lift sessions done per type this week, from recordings and manual marks. */
  liftsDone: Record<LiftKey, number>;
}

function resolveWeek(d: ViewData, weekStart: Day): ResolvedWeek {
  const plan = planFor(d, weekStart);
  const manual = new Set((d.manualDone ?? []).map((m) => m.sessionId));
  const logged = {
    rideDates: new Set(d.rides.map((r) => r.date)),
    liftDates: new Set(d.lifts.map((l) => l.date)),
  };
  const now = d.now ?? new Date(`${d.today}T19:00:00Z`);
  const planned: PlannedSession[] = plan?.sessions ?? [];

  const sessions: Session[] = planned.map((p) => {
    let status: SessionStatus = sessionStatus(p, logged, now);
    let doneSource: Session["doneSource"];
    if (p.status !== "skipped" && manual.has(p.id)) {
      status = "done";
      doneSource = "manual";
    } else if (status === "done") {
      doneSource = "intervals";
    }
    const s: Session = { id: p.id, date: p.date, kind: p.kind, title: p.title, minutes: p.minutes, detail: null, status };
    if (doneSource) s.doneSource = doneSource;
    return s;
  });

  const match = matchLifts(planned, d.lifts.filter((l) => l.date >= weekStart && l.date <= addDays(weekStart, 6)));
  const counted = liftCounts(match, { upper: 7, lower: 7 });
  const matchedSessions = new Set([...match.matched.values()].map((m) => m.sessionId));
  const liftsDone: Record<LiftKey, number> = { upper: counted.upper.actual, lower: counted.lower.actual };
  for (const p of planned) {
    const k = liftOf(p.kind);
    if (k && p.status !== "skipped" && manual.has(p.id) && !matchedSessions.has(p.id)) liftsDone[k] += 1;
  }

  return {
    start: weekStart,
    sessions,
    weekSessions: sessions.map((s) => ({ id: s.id, date: s.date, kind: s.kind, title: s.title, minutes: s.minutes, status: s.status })),
    plan,
    liftsDone,
  };
}

// ---- Home ----

export interface HomeView {
  date: Day;
  weekLabel: string;
  isRecoveryWeek: boolean;
  /** Null until its inputs are decided (NEXT-STEPS item 7). */
  readiness: null | { light: "green" | "yellow" | "red"; label: string; reasons: string[] };
  today: Session | null;
  goals: GoalBar[];
  offGoals: OffGoal[];
  fatigue: null | { form: number; ramp: number | null; load: number | null; note: string | null };
  lastSyncedAt: string;
}

export function homeView(d: ViewData, date: Day = d.today): HomeView {
  const start = mondayOf(date);
  const state = stateFor(d, start);
  const wk = resolveWeek(d, start);
  const current = state.current;
  const actuals = actualsThrough(d, start).get(start) ?? {};

  const goals: GoalBar[] = [];
  if (current) {
    for (const key of GOAL_KEYS) {
      const target = current.targets[key];
      if (target === undefined) continue;
      const actual = actuals[key] ?? 0;
      goals.push({ key, label: GOAL_LABEL[key], unit: "min", actual: Math.round(actual), target, hit: actual >= target });
    }
  }

  const liftTargets = d.liftTargets ?? { upper: 1, lower: 1 };
  for (const k of LIFT_KEYS) {
    const target = Math.min(7, Math.max(0, Math.round(liftTargets[k])));
    if (target === 0) continue;
    const actual = wk.liftsDone[k];
    const bar: GoalBar = { key: k, label: LIFT_LABEL[k], unit: "sessions", actual, target, hit: actual >= target };
    if (!bar.hit) {
      const open = wk.sessions.find((s) => liftOf(s.kind) === k && s.status === "not_logged");
      if (open) {
        const fits = dayOptions({ sessions: wk.weekSessions, sessionId: open.id, action: "move", today: d.today }).options
          // Days with no warning first, so the nudge doesn't suggest putting a lift on a quality day.
          .sort((a, b) => Number(a.rules.some((r) => r.result === "warn")) - Number(b.rules.some((r) => r.result === "warn")))
          .map((o) => o.id.slice("move:".length))
          .slice(0, 2)
          .sort();
        if (fits.length > 0) {
          bar.nudge = {
            text: `Still open from ${dayName(open.date)}. ${fits.map(dayAbbr).join(" or ")} fits.`,
            date: fits[0]!,
            sessionId: open.id,
          };
        }
      }
    }
    goals.push(bar);
  }

  const offGoals: OffGoal[] = [];
  if (current) {
    const nextPlan = planFor(d, addDays(start, 7));
    for (const key of current.notPlanned) {
      const back = state.nextIfHit?.targets[key];
      let text = "Not planned this week.";
      if (back !== undefined && state.nextIfHit) {
        const session = nextPlan?.sessions.find((s) => s.status !== "skipped" && goalServedBy(s.kind) === key);
        text += ` Back ${monthDay(session?.date ?? state.nextIfHit.start)} at ${back} min.`;
      }
      offGoals.push({ key, label: GOAL_LABEL[key], text });
    }
  }

  const f = fatigueOn(d.wellness ?? [], date);
  const todaySession = wk.sessions.find((s) => s.date === date && s.status !== "skipped") ?? null;
  const n = weeksBetween(d.program.startWeek, start) + 1;

  return {
    date,
    weekLabel: n >= 1 ? `week ${n} of the program` : "before the program starts",
    isRecoveryWeek: current?.isRecovery ?? false,
    readiness: null,
    today: todaySession,
    goals,
    offGoals,
    fatigue: f ? { form: f.form, ramp: f.rampRate, load: null, note: null } : null,
    lastSyncedAt: d.lastSyncedAt,
  };
}

// ---- Week ----

export interface WeekView {
  start: Day;
  label: string;
  days: { date: Day; isToday: boolean; isPast: boolean; sessions: Session[] }[];
  nextWeekNote: string | null;
}

export function weekView(d: ViewData, start: Day = mondayOf(d.today)): WeekView {
  const monday = mondayOf(start);
  const wk = resolveWeek(d, monday);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { date, isToday: date === d.today, isPast: date < d.today, sessions: wk.sessions.filter((s) => s.date === date) };
  });

  let nextWeekNote: string | null = null;
  const state = stateFor(d, monday);
  const nextPlan = planFor(d, addDays(monday, 7));
  if (state.current && state.nextIfHit && nextPlan) {
    const lines: string[] = [];
    for (const key of GOAL_KEYS) {
      const nextTarget = state.nextIfHit.targets[key];
      const planned = state.current.targets[key] !== undefined;
      if (nextTarget !== undefined && !planned) {
        const s = nextPlan.sessions.find((x) => x.status !== "skipped" && goalServedBy(x.kind) === key);
        lines.push(`${GOAL_LABEL[key]} returns ${s ? dayName(s.date) : "next week"} at ${nextTarget} min.`);
      } else if (nextTarget === undefined && planned) {
        lines.push(`${GOAL_LABEL[key]} sits out.`);
      }
    }
    nextWeekNote = lines.length > 0 ? lines.join(" ") : null;
  }

  return { start: monday, label: weekLabel(monday), days, nextWeekNote };
}

// ---- Day options ----

export interface DayOptionsView extends DayOptions {
  session: Session;
}

export function sessionOptionsView(d: ViewData, sessionId: string, action: OptionAction): DayOptionsView {
  const plan = d.plans.find((p) => p.sessions.some((s) => s.id === sessionId));
  if (!plan) throw new Error(`unknown session ${sessionId}`);
  const wk = resolveWeek(d, plan.weekStart);
  const session = wk.sessions.find((s) => s.id === sessionId)!;
  return { session, ...dayOptions({ sessions: wk.weekSessions, sessionId, action, today: d.today }) };
}

// ---- Program and goals ----

export interface ProgramView {
  goals: { key: GoalKey; label: string; mode: GoalMode; target: number; stepMin: number; summary: string }[];
  lifts: Record<LiftKey, number>;
  recovery: { streak: number; after: number; factor: number; text: string };
}

/** The target a goal sits at now, ignoring a recovery reduction. */
function nominalTarget(state: ProgramState, key: GoalKey): number | null {
  const cur = state.current;
  if (!cur) return null;
  if (cur.isRecovery) return state.nextIfHit?.carried[key] ?? null;
  return cur.targets[key] ?? state.nextIfHit?.carried[key] ?? null;
}

function summaryFor(mode: GoalMode, target: number, stepMin: number): string {
  if (mode === "off") return "Not tracked";
  if (mode === "hold") return `Holds at ${target} min`;
  return `${target} min, up ${stepMin} after each hit week`;
}

export function programView(d: ViewData, date: Day = d.today): ProgramView {
  const start = mondayOf(date);
  const state = stateFor(d, start);
  const cfg = configsAt(d, start);
  const goals = GOAL_KEYS.map((key) => {
    const target = nominalTarget(state, key) ?? cfg[key].start;
    return { key, label: GOAL_LABEL[key], mode: cfg[key].mode, target, stepMin: cfg[key].stepMin, summary: summaryFor(cfg[key].mode, target, cfg[key].stepMin) };
  });
  const after = d.program.recoveryAfter;
  const streak = state.current?.streakBefore ?? 0;
  const pct = Math.round(d.program.recoveryFactor * 100);
  const text =
    after === 0
      ? "Recovery weeks are off."
      : state.current?.isRecovery
        ? `Recovery week: targets at ${pct}%, not judged.`
        : `A recovery week follows ${after} hit weeks in a row (${streak} of ${after} so far). It runs targets at ${pct}%.`;
  return {
    goals,
    lifts: { ...(d.liftTargets ?? { upper: 1, lower: 1 }) },
    recovery: { streak, after, factor: d.program.recoveryFactor, text },
  };
}

export interface GoalPreviewPoint {
  date: Day;
  target: number;
  isRecovery: boolean;
}

export interface GoalView {
  key: GoalKey;
  label: string;
  definition: string;
  mode: GoalMode;
  target: number;
  stepMin: number;
  preview: GoalPreviewPoint[];
}

export interface GoalDraft {
  mode: GoalMode;
  target: number;
  stepMin: number;
}

const PREVIEW_WEEKS = 6;
const PREVIEW_SCAN = 26;

/**
 * Next planned weeks for one goal, assuming every week is hit. A week with no
 * plan data counts as planned, as in the engine. The draft applies from the
 * current week, which is how a save behaves.
 */
export function goalPreview(d: ViewData, key: GoalKey, draft?: GoalDraft, date: Day = d.today): GoalPreviewPoint[] {
  const start = mondayOf(date);
  const extra: GoalChange[] = draft ? [{ effectiveWeek: start, goal: key, change: { mode: draft.mode, start: draft.target, stepMin: draft.stepMin } }] : [];
  if (draft?.mode === "off") return [];

  const actuals = actualsThrough(d, start);
  const out: GoalPreviewPoint[] = [];
  for (let i = 0; i < PREVIEW_SCAN && out.length < PREVIEW_WEEKS; i++) {
    const week = addDays(start, 7 * i);
    const cur = programState(d.program, actuals, week, { planned: plannedMap(d), changes: [...(d.changes ?? []), ...extra] }).current;
    if (!cur) break;
    // Assume every goal planned that week is hit, so the next week reflects the step-up and the streak.
    const hitAll: Partial<GoalMinutes> = { ...(actuals.get(week) ?? {}) };
    for (const g of GOAL_KEYS) {
      const t = cur.targets[g];
      if (t !== undefined) hitAll[g] = Math.max(hitAll[g] ?? 0, t);
    }
    actuals.set(week, hitAll);

    const target = cur.targets[key];
    if (target === undefined) continue; // unplanned or off: nothing judged, nothing to show
    const s = planFor(d, week)?.sessions.find((x) => x.status !== "skipped" && goalServedBy(x.kind) === key);
    out.push({ date: s?.date ?? week, target, isRecovery: cur.isRecovery });
  }
  return out;
}

export function goalView(d: ViewData, key: GoalKey, date: Day = d.today): GoalView {
  const start = mondayOf(date);
  const state = stateFor(d, start);
  const cfg = configsAt(d, start)[key];
  const target = nominalTarget(state, key) ?? cfg.start;
  return {
    key,
    label: GOAL_LABEL[key],
    definition: GOAL_DEFINITION[key],
    mode: cfg.mode,
    target,
    stepMin: cfg.stepMin,
    preview: goalPreview(d, key, undefined, date),
  };
}
