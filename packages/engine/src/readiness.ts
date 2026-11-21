import { addDays } from "./dates";
import type { Fatigue } from "./fatigue";
import type { RideZones } from "./intervals";

/**
 * Readiness pill. Three inputs from intervals.icu data (HRV, resting HR and
 * sleep are null, so they are not used): Form, ramp rate and recent hard days.
 * Each input gets its own light; the pill shows the worst of them.
 *
 * THRESHOLDS ARE PROVISIONAL (decided 2026-11-20). They are textbook starting
 * points, not fitted to Narjit's data. Every reading is logged with a
 * prediction and scored against what happened, and the thresholds change only
 * when that record says so. Bump `READINESS_VERSION` when they do.
 */
export const READINESS_VERSION = "2026-11-21-provisional";

export type Light = "green" | "yellow" | "red";

export const READINESS_THRESHOLDS = {
  /** Form (CTL minus ATL): at or above -10 is green, down to -20 is yellow, below is red. */
  form: { yellow: -10, red: -20 },
  /** Ramp rate, CTL per week: up to 5 is green, up to 8 is yellow, above is red. */
  ramp: { yellow: 5, red: 8 },
  /** Hard days (VO2 or sweet spot rides) in the 3 days before: 0 or 1 is green, 2 is yellow, 3 is red. */
  hardDays: { yellow: 2, red: 3, windowDays: 3 },
} as const;

export interface ReadinessInput {
  key: "form" | "ramp" | "hardDays";
  label: string;
  /** What the app shows for the value, e.g. "−12" or "2 of the last 3 days". */
  value: string;
  light: Light;
  /** The rule this input was judged by, shown on tap. */
  rule: string;
}

export interface Readiness {
  light: Light;
  label: string;
  /** One line per input that isn't green. Empty when everything is green. */
  reasons: string[];
  /** Every input that was available, so a tap can show them all. */
  inputs: ReadinessInput[];
  /** Inputs that couldn't be read. Never filled with a guess. */
  missing: string[];
  provisional: true;
  version: string;
}

const RANK: Record<Light, number> = { green: 0, yellow: 1, red: 2 };
const LABEL: Record<Light, string> = { green: "Ready", yellow: "Take care today", red: "Hold back today" };
const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : n > 0 ? `+${n}` : "0");

/** Dates in the window before `date` that carry a hard ride (a VO2 or sweet spot category). */
export function hardDaysBefore(rides: readonly RideZones[], date: string): string[] {
  const from = addDays(date, -READINESS_THRESHOLDS.hardDays.windowDays);
  const days = new Set<string>();
  for (const r of rides) {
    if (r.date >= from && r.date < date && (r.category === "vo2" || r.category === "sweet_spot")) days.add(r.date);
  }
  return [...days].sort();
}

/**
 * Null when nothing can be read. Form and ramp come from the wellness row for
 * `date` (or the latest before it); hard days need rides, and an empty ride
 * list is a legitimate zero, so that input is always available.
 */
export function readiness(fatigue: Fatigue | null, rides: readonly RideZones[], date: string): Readiness | null {
  const T = READINESS_THRESHOLDS;
  const inputs: ReadinessInput[] = [];
  const missing: string[] = [];

  if (fatigue) {
    const f = fatigue.form;
    inputs.push({
      key: "form",
      label: "Form",
      value: signed(f),
      light: f >= T.form.yellow ? "green" : f >= T.form.red ? "yellow" : "red",
      rule: `Green at ${signed(T.form.yellow)} or higher, yellow down to ${signed(T.form.red)}, red below.`,
    });
    if (fatigue.rampRate !== null) {
      const r = fatigue.rampRate;
      inputs.push({
        key: "ramp",
        label: "Ramp rate",
        value: `${signed(r)} per week`,
        light: r <= T.ramp.yellow ? "green" : r <= T.ramp.red ? "yellow" : "red",
        rule: `Green up to ${T.ramp.yellow} CTL a week, yellow up to ${T.ramp.red}, red above.`,
      });
    } else missing.push("Ramp rate");
  } else missing.push("Form", "Ramp rate");

  const hard = hardDaysBefore(rides, date).length;
  inputs.push({
    key: "hardDays",
    label: "Recent hard days",
    value: `${hard} of the last ${T.hardDays.windowDays} days`,
    light: hard >= T.hardDays.red ? "red" : hard >= T.hardDays.yellow ? "yellow" : "green",
    rule: `Hard means a VO2 or sweet spot ride. Green at 0 or 1, yellow at ${T.hardDays.yellow}, red at ${T.hardDays.red}.`,
  });

  // Hard days alone can't stand in for fatigue data: with no wellness row there is no reading.
  if (!fatigue) return null;

  const light = inputs.reduce<Light>((w, i) => (RANK[i.light] > RANK[w] ? i.light : w), "green");
  const reasons = inputs
    .filter((i) => i.light !== "green")
    .map((i) => {
      if (i.key === "form") return `Form is ${i.value}: you're carrying fatigue.`;
      if (i.key === "ramp") return `Fitness is rising ${i.value}, faster than usual.`;
      return `${hard} hard ${hard === 1 ? "day" : "days"} in the last ${T.hardDays.windowDays}.`;
    });
  return { light, label: LABEL[light], reasons, inputs, missing, provisional: true, version: READINESS_VERSION };
}

// ---- Prediction and scoring ----

/** What a reading predicts about the day's planned session. Logged with the reading. */
export interface ReadinessPrediction {
  date: string;
  light: Light;
  /** The planned session the reading is about; null on a day with none (nothing to score). */
  sessionId: string | null;
  kind: string | null;
  /** Green predicts the session is done at its goal; yellow and red predict a shortfall. */
  expect: "completes" | "shortfall";
}

export function predictFor(r: Readiness, date: string, session: { id: string; kind: string } | null): ReadinessPrediction {
  return { date, light: r.light, sessionId: session?.id ?? null, kind: session?.kind ?? null, expect: r.light === "green" ? "completes" : "shortfall" };
}

export interface ReadinessOutcome {
  date: string;
  /** A ride was logged that day (a lift for lift sessions). */
  done: boolean;
  /** For sessions that serve a zone goal: minutes in that goal's zone that day, and the week's target. Null otherwise. */
  goalMinutes: number | null;
  targetMin: number | null;
  /** Done, and (when there's a zone goal) the day's minutes reached the target. */
  completed: boolean;
}

export interface ReadinessScore {
  correct: boolean;
  predicted: ReadinessPrediction["expect"];
  actual: "completes" | "shortfall";
}

export function scoreReading(p: ReadinessPrediction, o: ReadinessOutcome): ReadinessScore {
  const actual = o.completed ? "completes" : "shortfall";
  return { correct: p.expect === actual, predicted: p.expect, actual };
}
