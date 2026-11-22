// Deletes every event on the agent-owned Training calendar (GOOGLE_CALENDAR_ID), so the app can write the plan fresh.
// Dry run by default: lists what it would delete. Pass --yes to delete. Prints counts and titles, never credentials.
import { accessToken, googleConfigFromEnv } from "./google";

const yes = process.argv.includes("--yes");
const cfg = googleConfigFromEnv();
const token = await accessToken(cfg);
const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}`;
const auth = { authorization: `Bearer ${token}` };

interface Ev { id: string; summary?: string; recurrence?: string[]; start?: { date?: string; dateTime?: string } }

// singleEvents=false lists each recurring series once; deleting the series removes all its instances and exceptions.
const events: Ev[] = [];
let pageToken: string | undefined;
do {
  const q = new URLSearchParams({ maxResults: "250", showDeleted: "false" });
  if (pageToken) q.set("pageToken", pageToken);
  const res = await fetch(`${base}/events?${q}`, { headers: auth });
  if (!res.ok) throw new Error(`list events -> HTTP ${res.status}`);
  const body = (await res.json()) as { items?: Ev[]; nextPageToken?: string };
  events.push(...(body.items ?? []));
  pageToken = body.nextPageToken;
} while (pageToken);

const series = events.filter((e) => e.recurrence).length;
console.log(`${events.length} events on the calendar (${series} recurring series, ${events.length - series} single).`);
for (const e of events.slice(0, 40)) console.log(`  ${e.start?.date ?? e.start?.dateTime?.slice(0, 10) ?? "?"}  ${e.summary ?? "(no title)"}${e.recurrence ? "  [series]" : ""}`);
if (events.length > 40) console.log(`  ... and ${events.length - 40} more`);

if (!yes) {
  console.log("\nDry run. Nothing deleted. Re-run with --yes to delete all of the above.");
  process.exit(0);
}

let deleted = 0;
for (const e of events) {
  const res = await fetch(`${base}/events/${encodeURIComponent(e.id)}`, { method: "DELETE", headers: auth });
  // 410 means already gone.
  if (!res.ok && res.status !== 410) throw new Error(`delete -> HTTP ${res.status} after ${deleted} deleted`);
  deleted++;
}
console.log(`\nDeleted ${deleted} events.`);
