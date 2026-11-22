import { addDays, mondayOf, weekdayMon0 } from "./dates";
import type { SessionKind, WeekPlan, PlannedSession } from "./calendar";
import { weekStrength, type WeekLift, type WeekStrength } from "./strength";
import { fatigueFor, type LoadRide, type LoadSettings, type WellnessRow } from "./fatigue";
import { predictFor, readiness, type Readiness, type ReadinessOutcome, type ReadinessPrediction } from "./readiness";
import { toActivityZones, type RideZones } from "./intervals";
import {
  goalServedBy,
  plannedGoals,
  sessionStatus,
  type LiftActivity,
  type LiftKey,
  type ResolvedStatus,
} from "./plan";
import { weeklyZoneRows } from "./scorecard";
import { matchRides, type RideMatch } from "./match";
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
  /** The ride that counted for this session. `substituted` when it was not the planned category. */
  matchedRide?: { activityId: string; detected: string; substituted: boolean };
  /** Moved in from an earlier week: the date it was planned for. */
  movedFrom?: Day;
  /** Moved out to a later week. This is the stand-in on its original day, and it counts as a miss. */
  movedTo?: Day;
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

/** The one Strength bar: every strength activity counts once, tagged upper or lower when known. */
export interface StrengthBar {
  label: string;
  actual: number;
  target: number;
  hit: boolean;
  upper: { actual: number; target: number };
  lower: { actual: number; target: number };
  /** This week's strength activities. Untagged ones show "tag it". */
  lifts: Array<Pick<WeekLift, "id" | "date" | "tag" | "tagSource">>;
  untagged: number;
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
  /** Upper or lower tags set by tapping, keyed by strength activity id. */
  liftTags?: Readonly<Record<string, LiftKey>>;
  /** Plans read from the calendar. A week missing here counts as everything planned for goals, and has no sessions. */
  plans: readonly WeekPlan[];
  rides: readonly RideZones[];
  lifts: readonly LiftActivity[];
  /** Sessions marked done by hand. */
  manualDone?: readonly { sessionId: string }[];
  wellness?: readonly WellnessRow[];
  /** Rides with power or HR for the own load calculation (both sources, deduplicated like `rides`). */
  loadRides?: readonly LoadRide[];
  /** FTP and threshold HR from intervals.icu. */
  loadSettings?: LoadSettings | null;
  lastSyncedAt: string;
}

/** Own load when FTP is known, else intervals.icu wellness. See `fatigueFor`. */
function currentFatigue(d: ViewData, date: Day) {
  return fatigueFor(
    { rides: d.loadRides ?? [], settings: d.loadSettings, wellness: d.wellness, programStart: d.program.startWeek },
    date,
  );
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
  /** Strength activities this week with their tags. */
  strength: WeekStrength;
  /** Planned lift sessions marked done by hand with no activity behind them. */
  manualLifts: Record<LiftKey, number>;
}

function resolveWeek(d: ViewData, weekStart: Day): ResolvedWeek {
  const plan = planFor(d, weekStart);
  const manual = new Set((d.manualDone ?? []).map((m) => m.sessionId));
  const logged = {
    // Rides count by category through matchRides, not by date alone.
    rideDates: new Set<string>(),
    liftDates: new Set(d.lifts.map((l) => l.date)),
  };
  const now = d.now ?? new Date(`${d.today}T19:00:00Z`);
  const planned: PlannedSession[] = plan?.sessions ?? [];

  const weekLifts = d.lifts.filter((l) => l.date >= weekStart && l.date <= addDays(weekStart, 6));
  const strength = weekStrength(planned, weekLifts, new Map(Object.entries(d.liftTags ?? {})));
  const settled = new Set(strength.lifts.flatMap((l) => (l.sessionId ? [l.sessionId] : [])));

  const matches: Map<string, RideMatch> = matchRides(planned, d.rides);

  const sessions: Session[] = planned.map((p) => {
    const m = matches.get(p.id);
    let status: SessionStatus = m?.ride ? "done" : sessionStatus(p, logged, now);
    let doneSource: Session["doneSource"];
    if (p.status !== "skipped" && settled.has(p.id) && status !== "done") {
      status = "done";
      doneSource = "intervals";
    } else if (p.status !== "skipped" && manual.has(p.id)) {
      status = "done";
      doneSource = "manual";
    } else if (status === "done") {
      doneSource = "intervals";
    }
    const s: Session = { id: p.id, date: p.date, kind: p.kind, title: p.title, minutes: p.minutes, detail: null, status };
    if (doneSource) s.doneSource = doneSource;
    if (m?.ride) s.matchedRide = { activityId: m.ride.id, detected: m.detected ?? "unknown", substituted: m.substituted };
    if (p.movedFrom) s.movedFrom = p.movedFrom;
    if (p.movedTo) s.movedTo = p.movedTo;
    return s;
  });

  const manualLifts: Record<LiftKey, number> = { upper: 0, lower: 0 };
  for (const p of planned) {
    const k = liftOf(p.kind);
    if (k && p.status !== "skipped" && manual.has(p.id) && !settled.has(p.id)) manualLifts[k] += 1;
  }

  return {
    start: weekStart,
    sessions,
    weekSessions: sessions.map((s) => ({
      id: s.id,
      date: s.date,
      kind: s.kind,
      title: s.title,
      minutes: s.minutes,
      status: s.status,
      ...(s.movedFrom ? { movedIn: true } : {}),
    })),
    plan,
    strength,
    manualLifts,
  };
}

// ---- Home ----

export interface HomeView {
  date: Day;
  weekLabel: string;
  isRecoveryWeek: boolean;
  /** Null when intervals.icu has no Form for the day. Provisional thresholds (see readiness.ts). */
  readiness: Readiness | null;
  today: Session | null;
  goals: GoalBar[];
  /** Null when both lift targets are 0. */
  strength: StrengthBar | null;
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
  const tgt = (k: LiftKey) => Math.min(7, Math.max(0, Math.round(liftTargets[k])));
  let strength: StrengthBar | null = null;
  if (tgt("upper") + tgt("lower") > 0) {
    const up = wk.strength.upper + wk.manualLifts.upper;
    const lo = wk.strength.lower + wk.manualLifts.lower;
    const total = wk.strength.total + wk.manualLifts.upper + wk.manualLifts.lower;
    const target = tgt("upper") + tgt("lower");
    strength = {
      label: "Strength",
      actual: total,
      target,
      hit: total >= target,
      upper: { actual: up, target: tgt("upper") },
      lower: { actual: lo, target: tgt("lower") },
      lifts: wk.strength.lifts.map(({ id, date, tag, tagSource }) => ({ id, date, tag, tagSource })),
      untagged: wk.strength.untagged,
    };
    if (!strength.hit) {
      // Prefer a type whose own target is still unmet.
      const short = (k: LiftKey) => (k === "upper" ? up < tgt("upper") : lo < tgt("lower"));
      const open = wk.sessions.find((s) => { const k = liftOf(s.kind); return k && short(k) && s.status === "not_logged"; });
      if (open) {
        const fits = dayOptions({ sessions: wk.weekSessions, sessionId: open.id, action: "move", today: d.today }).options
          // Days with no warning first, so the nudge doesn't suggest putting a lift on a quality day.
          .sort((a, b) => Number(a.rules.some((r) => r.result === "warn")) - Number(b.rules.some((r) => r.result === "warn")))
          .map((o) => o.id.slice("move:".length))
          .slice(0, 2)
          .sort();
        if (fits.length > 0) {
          strength.nudge = {
            text: `Still open from ${dayName(open.date)}. ${fits.map(dayAbbr).join(" or ")} fits.`,
            date: fits[0]!,
            sessionId: open.id,
          };
        }
      }
    }
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

  const fr = currentFatigue(d, date);
  const f = fr?.fatigue ?? null;
  const todaySession = wk.sessions.find((s) => s.date === date && s.status !== "skipped") ?? null;
  const n = weeksBetween(d.program.startWeek, start) + 1;

  return {
    date,
    weekLabel: n >= 1 ? `week ${n} of the program` : "before the program starts",
    isRecoveryWeek: current?.isRecovery ?? false,
    readiness: readiness(f, d.rides, date),
    today: todaySession,
    goals,
    strength,
    offGoals,
    fatigue: f ? { form: f.form, ramp: f.rampRate, load: null, note: fr?.note ?? null } : null,
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
    if (state.nextIfHit.isRecovery) lines.push("Next week is a recovery week if you hit this one.");
    nextWeekNote = lines.length > 0 ? lines.join(" ") : null;
  }

  return { start: monday, label: weekLabel(monday), days, nextWeekNote };
}

// ---- Month ----

export interface MonthDay {
  date: Day;
  /** False for the lead-in and tail days that fill the first and last week. */
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  sessions: Pick<Session, "id" | "kind" | "status" | "title" | "movedTo" | "movedFrom">[];
}

export interface MonthView {
  /** "2026-11". */
  month: string;
  label: string;
  /** Monday of the first week shown. */
  start: Day;
  weeks: { start: Day; days: MonthDay[] }[];
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The Monday-start weeks that cover the month containing `date`. Weeks with no plan data show no sessions. */
export function monthView(d: ViewData, date: Day = d.today): MonthView {
  const first = `${date.slice(0, 7)}-01`;
  const next = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const last = addDays(next, -1);
  const weeks: MonthView["weeks"] = [];
  for (let m = mondayOf(first); m <= last; m = addDays(m, 7)) {
    const wk = resolveWeek(d, m);
    weeks.push({
      start: m,
      days: Array.from({ length: 7 }, (_, i) => {
        const day = addDays(m, i);
        return {
          date: day,
          inMonth: day.slice(0, 7) === first.slice(0, 7),
          isToday: day === d.today,
          isPast: day < d.today,
          sessions: wk.sessions
            .filter((s) => s.date === day)
            .map((s) => ({ id: s.id, kind: s.kind, status: s.status, title: s.title, ...(s.movedTo ? { movedTo: s.movedTo } : {}), ...(s.movedFrom ? { movedFrom: s.movedFrom } : {}) })),
        };
      }),
    });
  }
  return { month: first.slice(0, 7), label: `${MONTH_NAMES[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`, start: weeks[0]!.start, weeks };
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
  const hasNext = planFor(d, addDays(plan.weekStart, 7)) !== undefined;
  const nextWeek = hasNext ? resolveWeek(d, addDays(plan.weekStart, 7)).weekSessions : undefined;
  return { session, ...dayOptions({ sessions: wk.weekSessions, sessionId, action, today: d.today, nextWeek }) };
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

// ---- Readiness: prediction and outcome ----

/** The reading for `date` and the prediction to log with it. Null when there is no reading. */
export function readinessPrediction(d: ViewData, date: Day = d.today): ReadinessPrediction | null {
  const r = readiness(currentFatigue(d, date)?.fatigue ?? null, d.rides, date);
  if (!r) return null;
  const s = resolveWeek(d, mondayOf(date)).sessions.find((x) => x.date === date && x.status !== "skipped" && x.kind !== "easy_spin");
  return predictFor(r, date, s ? { id: s.id, kind: s.kind } : null);
}

/**
 * What happened on a predicted day, once the day is over. Null while it's still
 * running or when the prediction had no session. "Completed" means the session
 * is done and, for a zone goal, that day's minutes in the goal's zone reached
 * the week's target for it. Every week carries one session per goal, so the
 * week's target is that session's target.
 */
export function readinessOutcome(d: ViewData, p: ReadinessPrediction): ReadinessOutcome | null {
  if (p.date >= d.today || !p.sessionId) return null;
  const monday = mondayOf(p.date);
  const session = resolveWeek(d, monday).sessions.find((s) => s.id === p.sessionId);
  if (!session) return null;
  const done = session.status === "done";
  const goal = goalServedBy(session.kind);
  if (!goal) return { date: p.date, done, goalMinutes: null, targetMin: null, completed: done };

  const day = weeklyZoneRows(toActivityZones(d.rides.filter((r) => r.date === p.date)), monday, 1)[0];
  const minutes =
    goal === "endurance" ? (day?.enduranceSeconds ?? 0) / 60
      : goal === "sweetSpot" ? (day?.ssSeconds ?? 0) / 60
      : goal === "threshold" ? (day?.z4 ?? 0) / 60
      : (day?.vo2Seconds ?? 0) / 60;
  const target = stateFor(d, monday).current?.targets[goal];
  if (target === undefined) return null; // goal wasn't judged that week: nothing to score against
  return { date: p.date, done, goalMinutes: Math.round(minutes), targetMin: target, completed: done && minutes >= target };
}
