/**
 * Fatigue from intervals.icu wellness rows (`/athlete/{id}/wellness`).
 * Fitness (CTL), fatigue (ATL) and ramp rate come from intervals.icu as-is;
 * Form is CTL minus ATL. Shapes UNVERIFIED against live data: check
 * `ctl`, `atl`, `rampRate` and `id` (the date) before relying on them.
 * HRV, resting HR and sleep are null until Garmin sends them, so they are
 * not read here.
 */
export interface WellnessRow {
  /** Local date, "YYYY-MM-DD". */
  id?: string;
  ctl?: number | null;
  atl?: number | null;
  rampRate?: number | null;
}

export interface Fatigue {
  date: string;
  fitness: number;
  fatigue: number;
  /** CTL minus ATL. Negative means carrying fatigue. */
  form: number;
  /** CTL change per week as reported by intervals.icu; null when absent. */
  rampRate: number | null;
}

const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The row for `date`, or the latest row before it. Null if none has CTL and ATL. Never fills gaps with a guess. */
export function fatigueOn(rows: readonly WellnessRow[], date: string): Fatigue | null {
  const usable = rows
    .filter((r): r is WellnessRow & { id: string; ctl: number; atl: number } => !!r.id && r.id <= date && num(r.ctl) && num(r.atl))
    .sort((a, b) => a.id.localeCompare(b.id));
  const r = usable[usable.length - 1];
  if (!r) return null;
  return {
    date: r.id,
    fitness: r.ctl,
    fatigue: r.atl,
    form: Math.round((r.ctl - r.atl) * 10) / 10,
    rampRate: num(r.rampRate) ? r.rampRate : null,
  };
}
