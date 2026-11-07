// Phase 0 spike: last 30 days of intervals.icu activities + zone settings.
// Run: node --env-file=.env.local scripts/spike/intervals-spike.mjs
// Writes the raw response to data/private/ (gitignored). Never prints the key.
import { mkdirSync, writeFileSync } from "node:fs";

const key = process.env.INTERVALS_API_KEY;
const id = process.env.INTERVALS_ATHLETE_ID;
if (!key || !id) throw new Error("Set INTERVALS_API_KEY and INTERVALS_ATHLETE_ID in .env.local");

const base = `https://intervals.icu/api/v1/athlete/${id}`;
const headers = { Authorization: "Basic " + Buffer.from(`API_KEY:${key}`).toString("base64") };

async function get(path) {
  const res = await fetch(base + path, { headers });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${res.statusText}`);
  return res.json();
}

// Dates are America/Denver calendar days.
const day = (d) => d.toLocaleDateString("en-CA", { timeZone: "America/Denver" });
const newest = new Date();
const oldest = new Date(newest.getTime() - 30 * 86400000);

const activities = await get(`/activities?oldest=${day(oldest)}&newest=${day(newest)}`);
const athlete = await get("");

mkdirSync("data/private", { recursive: true });
writeFileSync("data/private/intervals-spike.json", JSON.stringify({ activities, athlete }, null, 2));

console.log(`Activities, ${day(oldest)} to ${day(newest)}: ${activities.length}`);
const bySource = {};
for (const a of activities) {
  const s = a.source ?? "unknown";
  const stub = a._note ? "stub(" + a._note + ")" : "full";
  const zones = a.icu_hr_zone_times || a.icu_zone_times ? "zones" : "no-zones";
  const k = `${s} | ${stub} | ${zones}`;
  bySource[k] = (bySource[k] ?? 0) + 1;
}
console.table(bySource);

console.log("\nRecent activities:");
for (const a of activities.slice(-10)) {
  console.log(
    a.start_date_local?.slice(0, 10),
    String(a.type).padEnd(14),
    String(a.source ?? "").padEnd(8),
    Math.round((a.moving_time ?? 0) / 60) + " min",
    a.icu_hr_zone_times ? "hr:" + a.icu_hr_zone_times.map((s) => Math.round(s / 60)).join("/") : "",
  );
}

console.log("\nSport settings (zones):");
for (const s of athlete.sportSettings ?? []) {
  console.log({ types: s.types, ftp: s.ftp, lthr: s.lthr, max_hr: s.max_hr, hr_zones: s.hr_zones, power_zones: s.power_zones });
}
