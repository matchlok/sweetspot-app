import type { PlannedSession } from "./calendar";
import { matchLifts, type LiftActivity, type LiftKey } from "./plan";

/**
 * Strength, decided 2026-11-21. Any strength activity counts once for its week,
 * whatever its length or the day it falls on (Narjit sometimes starts late).
 * A tag then puts it in the upper or lower bucket. The tag comes, in order, from
 * a tap in the app, a fuzzy read of the activity's title, description and Strava
 * private note, then a planned lift of that type on the same day. No tag stays
 * untagged and asks for one; it still fills the total.
 */

export type TagSource = "manual" | "note" | "plan";

const UPPER = ["upper", "arms", "arm", "push", "pull", "chest", "shoulders", "shoulder", "biceps", "triceps", "press", "bench", "curl", "curls", "row", "rows", "ohp", "dips"];
const LOWER = ["lower", "legs", "leg", "squat", "squats", "deadlift", "deadlifts", "glutes", "lunge", "lunges", "dl", "rdl", "sumo", "calf", "calves", "hamstring", "hamstrings", "quad", "quads"];

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** One-character typos are tolerated on keywords of five or more letters; shorter keywords must match exactly. */
const hits = (words: readonly string[], list: readonly string[]) =>
  words.some((w) => list.some((k) => w === k || (k.length >= 5 && w.length >= 4 && distance(w, k) <= 1)));

/**
 * Upper or lower from free text, or null. "Lift A" is lower and "Lift B" is
 * upper. Text that reads as both, or neither, is null: never a guess.
 */
export function tagFromText(text: string | null | undefined): LiftKey | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const words = t.split(/[^a-z]+/).filter(Boolean);
  let upper = hits(words, UPPER);
  let lower = hits(words, LOWER);
  if (/\blift\s*a\b/.test(t)) lower = true;
  if (/\blift\s*b\b/.test(t)) upper = true;
  return upper === lower ? null : upper ? "upper" : "lower";
}

export interface WeekLift {
  id: string;
  date: string;
  tag: LiftKey | null;
  tagSource: TagSource | null;
  /** The planned lift session this activity counts for, if one is open. */
  sessionId?: string;
}

export interface WeekStrength {
  lifts: WeekLift[];
  /** Every strength activity this week, tagged or not. */
  total: number;
  upper: number;
  lower: number;
  untagged: number;
}

/**
 * Strength for one week. `lifts` are the week's strength activities, `manualTags`
 * are taps in the app by activity id, `planned` the week's calendar sessions.
 */
export function weekStrength(
  planned: readonly PlannedSession[],
  lifts: readonly LiftActivity[],
  manualTags: ReadonlyMap<string, LiftKey> = new Map(),
): WeekStrength {
  const sameDay = matchLifts(planned, lifts).matched;
  const rows: WeekLift[] = [...lifts]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((l) => {
      const manual = manualTags.get(l.id);
      if (manual) return { id: l.id, date: l.date, tag: manual, tagSource: "manual" as const };
      const text = tagFromText(l.text);
      if (text) return { id: l.id, date: l.date, tag: text, tagSource: "note" as const };
      const day = sameDay.get(l.id);
      if (day) return { id: l.id, date: l.date, tag: day.lift, tagSource: "plan" as const };
      return { id: l.id, date: l.date, tag: null, tagSource: null };
    });

  // Each tagged lift settles the earliest open planned lift of its type, so a lift done on an
  // off day doesn't leave "Still open from Monday" behind. Untagged ones settle nothing.
  const open = planned.filter((s) => s.status !== "skipped" && (s.kind === "lift_upper" || s.kind === "lift_lower"));
  const used = new Set<string>();
  const want = (k: LiftKey) => (k === "upper" ? "lift_upper" : "lift_lower");
  for (const r of rows) {
    if (!r.tag) continue;
    const day = sameDay.get(r.id);
    const s =
      (day && day.lift === r.tag && !used.has(day.sessionId) ? open.find((p) => p.id === day.sessionId) : undefined) ??
      open.find((p) => p.kind === want(r.tag!) && !used.has(p.id));
    if (s) {
      used.add(s.id);
      r.sessionId = s.id;
    }
  }

  const count = (k: LiftKey) => rows.filter((r) => r.tag === k).length;
  return { lifts: rows, total: rows.length, upper: count("upper"), lower: count("lower"), untagged: rows.filter((r) => !r.tag).length };
}
