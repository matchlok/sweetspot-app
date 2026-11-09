/**
 * Throwaway POC: serves a Home screen fed by the real engine and live
 * intervals.icu data. Not the product (that's SwiftUI). Localhost only.
 * Run: see README.md. Credentials are read from ../../.env.local and never
 * sent to the browser.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ZONE_BANDS,
  addDays,
  denverToday,
  fetchRides,
  mondayOf,
  toActivityZones,
  weeklyZoneRows,
  zoneScorecard,
} from "../../packages/engine/src/index";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 5174;

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(here, "../../.env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return env;
}

async function home() {
  const env = loadEnv();
  if (!env.INTERVALS_API_KEY || !env.INTERVALS_ATHLETE_ID) throw new Error("intervals.icu env vars missing");
  const today = denverToday();
  const monday = mondayOf(today);
  const oldest = addDays(monday, -21); // this week + 3 back
  const rides = await fetchRides(
    { apiKey: env.INTERVALS_API_KEY, athleteId: env.INTERVALS_ATHLETE_ID },
    oldest,
    today,
  );
  const weeks = weeklyZoneRows(toActivityZones(rides), today, 4);
  // The plan isn't connected yet, so every week is scored against the normal band.
  const planKinds = new Map(weeks.map((w) => [w.start, new Set(["assumed-normal"])]));
  const scores = zoneScorecard(weeks, planKinds, today);
  return {
    today,
    weekStart: monday,
    bands: ZONE_BANDS.normal,
    scores,
    weeks,
    rides: rides
      .filter((r) => r.date >= monday)
      .map((r) => ({
        id: r.id,
        date: r.date,
        minutes: Math.round(r.movingSeconds / 60),
        category: r.category,
        source: r.categorySource,
      })),
  };
}

const page = readFileSync(join(here, "public/index.html"), "utf8");

createServer(async (req, res) => {
  try {
    if (req.url === "/api/home") {
      const body = JSON.stringify(await home());
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body);
    } else if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
    } else {
      res.writeHead(404).end("not found");
    }
  } catch (e) {
    // Message only: never include request headers or env values.
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : "error" }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Sweetspot POC: http://localhost:${PORT}`));
