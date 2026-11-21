// Golden check: compute zones from the Strava power stream and compare with intervals.icu on a ride both hold.
//   node --env-file=../../.env.local --import tsx src/zonecheck.ts 2026-11-13
import { connect } from "@sweetspot/db";
import { zonesFromPowerStream } from "@sweetspot/engine";
import { pgRepo } from "./pgRepo";
import { fetchPowerStream, stravaConfigFromEnv } from "./strava";
import { fetchStravaActivities } from "./strava";

const date = process.argv[2] ?? "2026-11-13";
const auth = "Basic " + Buffer.from(`API_KEY:${process.env.INTERVALS_API_KEY}`).toString("base64");
const base = `https://intervals.icu/api/v1/athlete/${process.env.INTERVALS_ATHLETE_ID}`;
const j = async (p: string) => (await fetch(`${base}/${p}`, { headers: { Authorization: auth } })).json();
const settings = ((await j("sport-settings")) as any[]).find((s) => s.types?.includes("Ride"));
const icu = ((await j(`activities?oldest=${date}&newest=${date}`)) as any[]).find((a) => a.device_watts);
const cfg = stravaConfigFromEnv(pgRepo(connect()))!;
const all = await fetchStravaActivities({ ...cfg }, date, date); // type filter is applied later, this lists every type
const strava = all.find((a) => a.type && /Ride/.test(a.type));
console.log("icu", icu?.id, icu?.moving_time, "strava", strava?.id, strava?.moving_time, "ftp", settings.ftp, "ss", settings.sweet_spot_min, settings.sweet_spot_max);
const st = await fetchPowerStream(cfg, strava!.id!);
if (!st) throw new Error("no stream");
console.log("samples", st.watts.length, "span", st.time.at(-1), "nulls", st.watts.filter((w) => w === null).length);
const want = Object.fromEntries(icu.icu_zone_times.map((z: any) => [z.id, z.secs]));
console.log("icu   ", JSON.stringify(want));
const r = zonesFromPowerStream(st, { ftp: settings.ftp, zoneTopsPct: settings.power_zones, sweetSpotPct: { min: settings.sweet_spot_min, max: settings.sweet_spot_max } })!;
const got = Object.fromEntries([...r.power.map((s, i) => [`Z${i + 1}`, s]), ["SS", r.sweetSpotSeconds]]);
console.log("mine  ", JSON.stringify(got));
console.log("diff  ", JSON.stringify(Object.fromEntries(Object.keys(want).map((k) => [k, (got[k] as number) - want[k]]))));
