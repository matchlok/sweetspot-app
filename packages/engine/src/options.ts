import { addDays, mondayOf, weekdayMon0 } from "./dates";
import type { SessionKind } from "./calendar";
import type { ResolvedStatus } from "./plan";

/**
 * Day options: the rule gate and option builder behind the day sheet
 * (`GET /api/sessions/:id/options`, shape in docs/plans/API.md). Pure and
 * deterministic. Effect lines come from templates, never an LLM, and the
 * rules here can block any proposal.
 *
 * First-version rules:
 * - nothing moves into or out of the past; options start today
 * - completed (and skipped) sessions don't move
 * - no lower-body lift the day before a quality ride (hard); a quality ride
 *   moved there pulls the lift to another day when one fits
 * - the long ride (endurance) keeps the weekend slot unless overridden
 * - one ride a day (hard)
 * - quality rides on back-to-back days, or a lift on a quality day, are
 *   allowed with a warning
 * Moves stay inside the session's own week (assumed 2026-11-11, awaiting Narjit's yes).
 */

export type OptionAction = "move" | "swap" | "skip";

export interface WeekSession {
  id: string;
  date: string;
  kind: SessionKind;
  title: string;
  minutes: number | null;
  status: ResolvedStatus | "done";
}

export interface DayOption {
  id: string;
  heading: string;
  effects: { text: string; tone: "plain" | "warn" }[];
  alsoMoves: { sessionId: string; to: string }[];
  cta: string;
  rules: { rule: string; result: "pass" | "warn" }[];
}

export interface DayOptions {
  sessionId: string;
  action: OptionAction;
  planVersion: string;
  options: DayOption[];
  blocked: { heading: string; reason: string }[];
  /** A not_logged lift can be marked done instead of moved. */
  canMarkDone?: boolean;
}

export interface DayOptionsInput {
  /** The session's whole week, in any order. */
  sessions: readonly WeekSession[];
  sessionId: string;
  action: OptionAction;
  /** Today's Denver date. */
  today: string;
  /** Let the long ride leave Saturday and Sunday. Off by default. */
  allowLongRideOffWeekend?: boolean;
}

// ---- Rules ----

const RULES = [
  "lower_lift_before_quality",
  "one_ride_per_day",
  "long_ride_weekend",
  "quality_back_to_back",
  "lift_with_quality",
] as const;
type Rule = (typeof RULES)[number];

interface Violation {
  rule: Rule;
  hard: boolean;
  /** Stable key so a violation already in the plan isn't charged to the change. */
  key: string;
  /** The session to move out of the way when that's the fix (the lift, for the lift rule). */
  fixId?: string;
  reason: string;
  /** Effect line when the rule only warns. Defaults to `reason`. */
  warnText?: string;
}

const QUALITY = new Set<SessionKind>(["sweet_spot", "threshold", "vo2"]);
const isLift = (k: SessionKind) => k === "lift_upper" || k === "lift_lower";
const isRide = (k: SessionKind) => !isLift(k);

const KIND_LABEL: Record<SessionKind, string> = {
  endurance: "Endurance ride",
  sweet_spot: "Sweet spot",
  threshold: "Threshold",
  vo2: "VO2 intervals",
  easy_spin: "Easy spin",
  lift_upper: "Upper lift",
  lift_lower: "Lower lift",
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayName = (d: string) => DAYS[weekdayMon0(d)]!;
const heading = (d: string) => `${dayName(d)}, ${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

type Layout = ReadonlyMap<string, string>; // session id -> date

function violations(sessions: readonly WeekSession[], layout: Layout, allowOffWeekend: boolean): Violation[] {
  const live = sessions.filter((s) => s.status !== "skipped");
  const date = (s: WeekSession) => layout.get(s.id) ?? s.date;
  const out: Violation[] = [];

  for (const l of live) {
    if (l.kind !== "lift_lower") continue;
    for (const q of live) {
      if (QUALITY.has(q.kind) && date(q) === addDays(date(l), 1)) {
        out.push({
          rule: "lower_lift_before_quality",
          hard: true,
          key: `lower:${l.id}:${q.id}`,
          fixId: l.id,
          reason: `Lower lift the day before ${KIND_LABEL[q.kind].toLowerCase()}`,
        });
      }
    }
  }
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      if (date(a) !== date(b)) continue;
      const [x, y] = a.id < b.id ? [a, b] : [b, a];
      if (isRide(a.kind) && isRide(b.kind)) {
        out.push({ rule: "one_ride_per_day", hard: true, key: `ride:${x.id}:${y.id}`, reason: "Already a ride that day" });
      } else if ((QUALITY.has(a.kind) && isLift(b.kind)) || (QUALITY.has(b.kind) && isLift(a.kind))) {
        out.push({ rule: "lift_with_quality", hard: false, key: `liftq:${x.id}:${y.id}`, reason: "Lift and quality ride on one day" });
      }
    }
  }
  for (const a of live) {
    if (QUALITY.has(a.kind)) {
      for (const b of live) {
        if (b.id !== a.id && QUALITY.has(b.kind) && date(b) === addDays(date(a), 1)) {
          out.push({ rule: "quality_back_to_back", hard: false, key: `b2b:${a.id}:${b.id}`, reason: "Quality rides on back-to-back days" });
        }
      }
    }
    if (a.kind === "endurance" && weekdayMon0(date(a)) < 5) {
      out.push({
        rule: "long_ride_weekend",
        hard: !allowOffWeekend,
        key: `long:${a.id}`,
        reason: "The long ride keeps the weekend",
        warnText: "Long ride leaves the weekend",
      });
    }
  }
  return out;
}

function planVersion(sessions: readonly WeekSession[]): string {
  const text = [...sessions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => `${s.id}|${s.date}|${s.kind}|${s.status}`)
    .join("\n");
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ---- Builder ----

export function dayOptions(input: DayOptionsInput): DayOptions {
  const { sessions, sessionId, action, today } = input;
  const allowOff = input.allowLongRideOffWeekend ?? false;
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) throw new Error(`unknown session ${sessionId}`);

  const result: DayOptions = { sessionId, action, planVersion: planVersion(sessions), options: [], blocked: [] };
  if (s.status === "not_logged" && isLift(s.kind)) result.canMarkDone = true;

  if (s.status === "done" || s.status === "skipped") {
    result.blocked.push({
      heading: s.status === "done" ? "Completed" : "Skipped",
      reason: s.status === "done" ? "Completed sessions don't move." : "A skipped session stays skipped.",
    });
    return result;
  }

  const base = violations(sessions, new Map(), allowOff);
  const baseKeys = new Set(base.map((v) => v.key));
  const fresh = (layout: Layout) => violations(sessions, layout, allowOff).filter((v) => !baseKeys.has(v.key));

  const weekStart = mondayOf(s.date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const movable = (x: WeekSession) => x.status === "planned" || x.status === "not_logged";

  if (action === "skip") {
    const onPlan = s.kind === "easy_spin";
    result.options.push({
      id: "skip",
      heading: "Skip it",
      effects: [
        onPlan
          ? { text: "Optional session. Skipping is on plan.", tone: "plain" }
          : { text: `${KIND_LABEL[s.kind]} counts as missed this week.`, tone: "warn" },
      ],
      alsoMoves: [],
      cta: "Skip it",
      rules: [{ rule: "completed_stays", result: "pass" }],
    });
    return result;
  }

  if (action === "move") {
    for (const day of days) {
      if (day === s.date) continue;
      if (day < today) continue; // nothing moves into the past
      const layout = new Map([[s.id, day]]);
      const bad = fresh(layout).filter((v) => v.hard);
      const alsoMoves: DayOption["alsoMoves"] = [];

      let working: Layout = layout;
      let unresolved = bad;
      // A lower lift in the way of a moved quality ride can step aside.
      const liftFix = bad.length > 0 && bad.every((v) => v.rule === "lower_lift_before_quality" && v.fixId && v.fixId !== s.id);
      if (liftFix) {
        const lift = sessions.find((x) => x.id === bad[0]!.fixId)!;
        const options = days
          .filter((d) => d >= today && d !== lift.date && movable(lift))
          .map((d) => {
            const l2 = new Map(layout).set(lift.id, d);
            const v = fresh(l2);
            return { d, l2, hard: v.filter((x) => x.hard).length, warn: v.filter((x) => !x.hard).length };
          })
          .filter((c) => c.hard === 0)
          .sort((a, b) => a.warn - b.warn || Math.abs(Date.parse(a.d) - Date.parse(lift.date)) - Math.abs(Date.parse(b.d) - Date.parse(lift.date)) || a.d.localeCompare(b.d));
        const pick = options[0];
        if (pick) {
          alsoMoves.push({ sessionId: lift.id, to: pick.d });
          working = pick.l2;
          unresolved = [];
        }
      }
      if (unresolved.length > 0) {
        result.blocked.push({ heading: heading(day), reason: unresolved[0]!.reason });
        continue;
      }

      const warns = fresh(working).filter((v) => !v.hard);
      const effects: DayOption["effects"] = [{ text: `${KIND_LABEL[s.kind]} moves to ${dayName(day)}.`, tone: "plain" }];
      for (const m of alsoMoves) {
        const x = sessions.find((q) => q.id === m.sessionId)!;
        effects.push({ text: `${KIND_LABEL[x.kind]} moves to ${dayName(m.to)} so it isn't the day before.`, tone: "plain" });
      }
      for (const w of warns) effects.push({ text: `${w.warnText ?? w.reason}.`, tone: "warn" });

      const touched = new Set<Rule>(fresh(working).map((v) => v.rule));
      result.options.push({
        id: `move:${day}`,
        heading: heading(day),
        effects,
        alsoMoves,
        cta: `Move to ${dayName(day)}` + alsoMoves.map((m) => `, ${lc(KIND_LABEL[sessions.find((q) => q.id === m.sessionId)!.kind]).replace(" lift", "")} to ${dayName(m.to)}`).join(""),
        rules: RULES.map((rule) => ({ rule, result: touched.has(rule) ? ("warn" as const) : ("pass" as const) })),
      });
    }
    return result;
  }

  // swap
  for (const other of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    if (other.id === s.id || other.date === s.date) continue;
    if (!movable(other)) continue;
    const layout = new Map([[s.id, other.date], [other.id, s.date]]);
    if (other.date < today || s.date < today) {
      result.blocked.push({ heading: `${heading(other.date)}, ${KIND_LABEL[other.kind]}`, reason: "Nothing moves into the past." });
      continue;
    }
    const v = fresh(layout);
    const hard = v.filter((x) => x.hard);
    const label = `${heading(other.date)}, ${KIND_LABEL[other.kind]}`;
    if (hard.length > 0) {
      result.blocked.push({ heading: label, reason: hard[0]!.reason });
      continue;
    }
    const warns = v.filter((x) => !x.hard);
    const touched = new Set<Rule>(v.map((x) => x.rule));
    result.options.push({
      id: `swap:${other.id}`,
      heading: label,
      effects: [
        { text: `${KIND_LABEL[s.kind]} moves to ${dayName(other.date)}.`, tone: "plain" },
        { text: `${KIND_LABEL[other.kind]} moves to ${dayName(s.date)}.`, tone: "plain" },
        ...warns.map((w) => ({ text: `${w.warnText ?? w.reason}.`, tone: "warn" as const })),
      ],
      alsoMoves: [{ sessionId: other.id, to: s.date }],
      cta: `Swap with ${lc(KIND_LABEL[other.kind])} on ${dayName(other.date)}`,
      rules: RULES.map((rule) => ({ rule, result: touched.has(rule) ? ("warn" as const) : ("pass" as const) })),
    });
  }
  return result;
}
