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

/* ------------------------------------------------------------------ *
 * Own load and fatigue (2026-11-21). Computed from rides in both sources
 * so Zwift rides that intervals.icu never receives still count.
 * Per-ride load is TSS-style: hours x IF^2 x 100.
 *   power rides: IF = normalized watts / FTP (Strava weighted_average_watts)
 *   HR-only rides: IF = average HR / threshold HR (PROVISIONAL estimate)
 *   neither: no load, counted in unknownRides, never guessed.
 * CTL is a 42-day and ATL a 7-day exponential average of daily load.
 * Strava-derived numbers are Strava data: Narjit only, never a public view.
 * ------------------------------------------------------------------ */

export interface LoadRide {
  /** America/Denver local date, "YYYY-MM-DD". */
  date: string;
  movingSeconds: number;
  /** Normalized power in watts (Strava weighted_average_watts), when the ride has sensor power. */
  normalizedWatts?: number | null;
  /** Average heart rate in bpm, for the HR estimate when there is no power. */
  avgHr?: number | null;
}

export interface LoadSettings {
  /** FTP in watts, read from intervals.icu (never held locally). */
  ftp: number;
  /** Threshold HR in bpm, from intervals.icu; without it HR-only rides are unknown. */
  thresholdHr?: number | null;
}

export type LoadMethod = "power" | "hr" | "unknown";

export interface RideLoad {
  load: number | null;
  method: LoadMethod;
}

/**
 * The HR estimate (hours x (avg HR / threshold HR)^2 x 100) ran about 1.3x
 * intervals.icu's own ride load on 8 HR-only rides (2026-11-21, range 1.12 to
 * 1.40). This scales it back. PROVISIONAL: re-fit with `apps/api/src/loadcheck.ts`
 * as HR-only rides accumulate.
 */
export const HR_LOAD_FACTOR = 0.77;

const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function rideLoad(ride: LoadRide, s: LoadSettings): RideLoad {
  if (!pos(ride.movingSeconds)) return { load: null, method: "unknown" };
  const hours = ride.movingSeconds / 3600;
  if (pos(ride.normalizedWatts) && pos(s.ftp)) {
    const f = ride.normalizedWatts / s.ftp;
    return { load: hours * f * f * 100, method: "power" };
  }
  if (pos(ride.avgHr) && pos(s.thresholdHr)) {
    const f = ride.avgHr / s.thresholdHr;
    return { load: hours * f * f * 100 * HR_LOAD_FACTOR, method: "hr" };
  }
  return { load: null, method: "unknown" };
}

export interface OwnFatigue {
  date: string;
  fitness: number;
  fatigue: number;
  /** CTL minus ATL. */
  form: number;
  /** CTL today minus CTL seven days earlier. */
  rampRate: number;
  /** Rides with no usable power or HR: they add no load, so the numbers may undercount. */
  unknownRides: number;
  /** Rides whose load came from the HR estimate. */
  hrEstimatedRides: number;
  /** Days of history before `date` that fed the averages. Short history means CTL is still warming up. */
  historyDays: number;
}

const CTL_DAYS = 42;
const ATL_DAYS = 7;
const DAY_MS = 86_400_000;
const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Own fitness, fatigue and Form on `date`. Starts at the first ride's date
 * with CTL = ATL = 0 (or `seed` if given), so early values warm up: check
 * `historyDays`. Null when there are no rides on or before `date`.
 */
export function ownFatigueOn(
  rides: readonly LoadRide[],
  s: LoadSettings,
  date: string,
  seed?: { date: string; fitness: number; fatigue: number },
): OwnFatigue | null {
  // A seed is the state at the close of its own day, so only later rides count.
  const upto = rides.filter((r) => r.date <= date && (!seed || r.date > seed.date));
  if (upto.length === 0 && !seed) return null;
  const first = seed?.date ?? upto.reduce((m, r) => (r.date < m ? r.date : m), upto[0]!.date);
  if (first > date) return null;
  const daily = new Map<string, number>();
  let unknownRides = 0;
  let hrEstimatedRides = 0;
  for (const r of upto) {
    const { load, method } = rideLoad(r, s);
    if (method === "unknown") unknownRides++;
    if (method === "hr") hrEstimatedRides++;
    if (load !== null) daily.set(r.date, (daily.get(r.date) ?? 0) + load);
  }
  const kc = 1 - Math.exp(-1 / CTL_DAYS);
  const ka = 1 - Math.exp(-1 / ATL_DAYS);
  let ctl = seed?.fitness ?? 0;
  let atl = seed?.fatigue ?? 0;
  let ctlWeekAgo = ctl;
  const end = parseDay(date);
  const start = parseDay(first);
  for (let t = seed ? start + DAY_MS : start; t <= end; t += DAY_MS) {
    const load = daily.get(fmtDay(t)) ?? 0;
    ctl += (load - ctl) * kc;
    atl += (load - atl) * ka;
    if (t === end - 7 * DAY_MS) ctlWeekAgo = ctl; // CTL at the close of that day
  }
  return {
    date,
    fitness: round1(ctl),
    fatigue: round1(atl),
    form: round1(ctl - atl),
    rampRate: round1(ctl - ctlWeekAgo),
    unknownRides,
    hrEstimatedRides,
    historyDays: Math.round((end - start) / DAY_MS),
  };
}

export interface FatigueInputs {
  rides: readonly LoadRide[];
  /** FTP and threshold HR from intervals.icu. Without them there is no own load. */
  settings?: LoadSettings | null;
  /** intervals.icu wellness rows: the fallback, and the seed for the own series. */
  wellness?: readonly WellnessRow[];
  /** First day of the program (a Monday): the own series starts the day before, seeded from wellness. */
  programStart: string;
}

export interface FatigueReading {
  fatigue: Fatigue;
  source: "own" | "intervals";
  /** What the reader should know about the number; null when nothing needs saying. */
  note: string | null;
}

/**
 * Form, fitness and ramp for `date`. Own load from every ride in both sources
 * when FTP is known (the Zwift rides intervals.icu never receives count), else
 * intervals.icu's wellness numbers. Null when neither can be read.
 */
export function fatigueFor(inp: FatigueInputs, date: string): FatigueReading | null {
  const wellness = inp.wellness ?? [];
  if (inp.settings) {
    const before = new Date(Date.parse(`${inp.programStart}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
    const row = fatigueOn(wellness, before);
    const seed = row && row.date === before ? { date: row.date, fitness: row.fitness, fatigue: row.fatigue } : undefined;
    const own = ownFatigueOn(inp.rides, inp.settings, date, seed);
    if (own) {
      const notes: string[] = [];
      if (!seed && own.historyDays < CTL_DAYS) notes.push(`Only ${own.historyDays} days of rides so far, so fitness is still warming up.`);
      if (own.unknownRides > 0) notes.push(`${own.unknownRides} ride${own.unknownRides === 1 ? "" : "s"} with no power or heart rate are not counted.`);
      if (own.hrEstimatedRides > 0) notes.push(`${own.hrEstimatedRides} ride${own.hrEstimatedRides === 1 ? "" : "s"} estimated from heart rate.`);
      return {
        fatigue: { date: own.date, fitness: own.fitness, fatigue: own.fatigue, form: own.form, rampRate: own.rampRate },
        source: "own",
        note: notes.length ? notes.join(" ") : null,
      };
    }
  }
  const w = fatigueOn(wellness, date);
  return w ? { fatigue: w, source: "intervals", note: inp.settings ? "From intervals.icu: rides it does not receive, such as Zwift, are missing." : null } : null;
}
