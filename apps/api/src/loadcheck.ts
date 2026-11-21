// Validate own load against intervals.icu using intervals.icu's own rides only (the Garmin-only case).
//   node --env-file=../../.env.local --import tsx src/loadcheck.ts [days=180]
// Per ride: our load vs `icu_training_load`. Per day: our CTL/ATL vs the wellness rows.
// Read-only. Prints no secrets.
import { mapLoadRides, ownFatigueOn, rideLoad, addDays, denverToday, type IntervalsActivity, type WellnessRow } from "@sweetspot/engine";
import { fetchLoadSettings, intervalsFromEnv } from "./sources";

const days = Number(process.argv[2] ?? 180);
const creds = intervalsFromEnv();
const auth = "Basic " + Buffer.from(`API_KEY:${creds.apiKey}`).toString("base64");
const base = `https://intervals.icu/api/v1/athlete/${creds.athleteId}`;
const get = async <T>(p: string) => (await (await fetch(`${base}/${p}`, { headers: { Authorization: auth } })).json()) as T;

const today = denverToday(new Date());
const oldest = addDays(today, -days);
const settings = await fetchLoadSettings(creds);
if (!settings) throw new Error("no cycling FTP in intervals.icu sport-settings");
const acts = await get<Array<IntervalsActivity & { icu_training_load?: number }>>(`activities?oldest=${oldest}&newest=${today}`);
const wellness = await get<WellnessRow[]>(`wellness?oldest=${oldest}&newest=${today}`);
console.log(`ftp ${settings.ftp}, lthr ${settings.thresholdHr ?? "unset"}, ${acts.length} activities, ${wellness.length} wellness rows since ${oldest}`);

// Per ride.
const rows = acts.flatMap((a) => {
  const [r] = mapLoadRides([a]);
  if (!r || typeof a.icu_training_load !== "number") return [];
  const mine = rideLoad(r, settings);
  return [{ date: r.date, method: mine.method, mine: mine.load, icu: a.icu_training_load }];
});
for (const m of ["power", "hr"] as const) {
  const set = rows.filter((r) => r.method === m && r.mine !== null && r.icu > 0);
  if (!set.length) { console.log(`${m}: no rides`); continue; }
  const ratios = set.map((r) => r.mine! / r.icu).sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)]!;
  console.log(`${m}: ${set.length} rides, mine/icu median ${med.toFixed(2)}, min ${ratios[0]!.toFixed(2)}, max ${ratios.at(-1)!.toFixed(2)}`);
}
console.log("unknown method:", rows.filter((r) => r.method === "unknown").length);

// Per day: series over this window only, so compare the last 4 weeks after a warm-up.
const loadRides = mapLoadRides(acts);
for (const back of [0, 7, 14, 21, 28]) {
  const d = addDays(today, -back);
  const mine = ownFatigueOn(loadRides, settings, d);
  const w = wellness.find((x) => x.id === d);
  if (!mine || !w) continue;
  console.log(`${d}  mine CTL ${mine.fitness} ATL ${mine.fatigue} Form ${mine.form}  |  icu CTL ${w.ctl?.toFixed?.(1)} ATL ${w.atl?.toFixed?.(1)} Form ${w.ctl != null && w.atl != null ? (w.ctl - w.atl).toFixed(1) : "?"}  (history ${mine.historyDays}d, unknown ${mine.unknownRides})`);
}
