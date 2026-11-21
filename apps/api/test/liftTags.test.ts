import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, IntervalsActivity } from "@sweetspot/engine";
import { createApp } from "../src/app";
import { signSession } from "../src/auth";
import { liftTagsFrom, loadViewData, syncActivities } from "../src/data";
import { memoryRepo } from "../src/repo";
import type { Sources } from "../src/sources";
import { memoryLoginStore } from "../src/store";

const SECRET = "x".repeat(48);
const events: CalendarEvent[] = [
  { id: "lift-b-1109", summary: "Lift B — Upper Body", start: { date: "2026-11-09" } },
  { id: "lift-a-1112", summary: "Lift A — Lower Body + Core", start: { date: "2026-11-12" } },
  { id: "end-1114", summary: "Endurance — Long Ride (~1.5 hr)", start: { date: "2026-11-14" } },
];
// A short lift on a day with no planned lift: it must still count.
const lift = (id: string, date: string, name = "Morning Weight Training"): IntervalsActivity => ({
  id: `strava:${id}`,
  type: "WeightTraining",
  source: "STRAVA",
  name,
  start_date_local: `${date}T06:00:00Z`,
  moving_time: 300,
});

function setup(strava: IntervalsActivity[], notes: Record<string, { description: string | null; private_note: string | null }> = {}) {
  const sources: Sources = {
    events: async () => events.map((e) => ({ ...e })),
    activities: async () => [],
    wellness: async () => [],
    stravaActivities: async () => strava,
    stravaNote: async (id) => {
      const n = notes[id];
      if (!n) throw new Error("strava activity -> HTTP 500");
      return n;
    },
    patchEvent: async () => {},
  };
  const repo = memoryRepo();
  const now = () => new Date("2026-11-11T19:00:00Z");
  const data = { repo, sources, now };
  const app = createApp({
    env: { JWT_SECRET: SECRET, APP_PASSPHRASE_HASH: `scrypt:1:1:1:${randomBytes(4).toString("base64url")}:x`, CRON_SECRET: "cron" },
    logins: memoryLoginStore(),
    data,
  });
  return { app, repo, data };
}

async function call(app: ReturnType<typeof setup>["app"], method: string, path: string, body?: unknown) {
  const { token } = await signSession(SECRET);
  const headers: Record<string, string> = { cookie: `sweetspot_session=${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("liftTagsFrom", () => {
  const e = (activityId: string, tag: unknown) => ({ inputs: { activityId }, choice: { tag } });
  it("the latest tap wins and null clears", () => {
    expect(liftTagsFrom([e("a", "upper"), e("a", "lower"), e("b", "upper"), e("b", null)])).toEqual({ a: "lower" });
  });
  it("ignores malformed entries", () => {
    expect(liftTagsFrom([{ inputs: null, choice: null }, { inputs: { activityId: 3 }, choice: { tag: "upper" } }])).toEqual({});
  });
});

describe("sync reads the Strava note for strength activities", () => {
  it("stores description and private note, so the note can tag the lift", async () => {
    const { data, repo } = setup([lift("1", "2026-11-10")], { "strava:1": { description: null, private_note: "Lift A, felt heavy" } });
    await syncActivities(data);
    const raw = (await repo.activities("2026-11-09", "2026-11-11"))[0]!.raw;
    expect(raw.private_note).toBe("Lift A, felt heavy");
    const home = (await import("@sweetspot/engine")).homeView(await loadViewData(data));
    expect(home.strength!.lifts[0]).toMatchObject({ tag: "lower", tagSource: "note" });
  });
  it("a failed note read keeps the sync going and leaves the lift untagged", async () => {
    const { data, repo } = setup([lift("2", "2026-11-10")]);
    const res = await syncActivities(data);
    expect(res.newActivities).toBe(1);
    expect((await repo.syncState()).lastError).toBeNull();
    const home = (await import("@sweetspot/engine")).homeView(await loadViewData(data));
    expect(home.strength).toMatchObject({ actual: 1, untagged: 1 });
  });
});

describe("PUT /api/lifts/:id/tag", () => {
  it("needs the cookie", async () => {
    const { app } = setup([]);
    expect((await app.request("/api/lifts/x/tag", { method: "PUT" })).status).toBe(401);
  });
  it("tags, re-tags and clears, and logs each tap", async () => {
    const { app, data, repo } = setup([lift("3", "2026-11-10")]);
    await syncActivities(data);
    const id = encodeURIComponent("strava:3");
    let res = await call(app, "PUT", `/api/lifts/${id}/tag`, { tag: "lower" });
    expect(res.status).toBe(200);
    expect((await res.json()).home.strength).toMatchObject({ untagged: 0, lower: { actual: 1 }, upper: { actual: 0 } });
    res = await call(app, "PUT", `/api/lifts/${id}/tag`, { tag: "upper" });
    expect((await res.json()).home.strength.lifts[0]).toMatchObject({ tag: "upper", tagSource: "manual" });
    res = await call(app, "PUT", `/api/lifts/${id}/tag`, { tag: null });
    expect((await res.json()).home.strength).toMatchObject({ untagged: 1 });
    expect((await repo.decisionsFor("lift_tag")).length).toBe(3);
  });
  it("rejects a bad tag and an unknown activity", async () => {
    const { app, data } = setup([lift("4", "2026-11-10")]);
    await syncActivities(data);
    expect((await call(app, "PUT", `/api/lifts/${encodeURIComponent("strava:4")}/tag`, { tag: "legs" })).status).toBe(400);
    expect((await call(app, "PUT", "/api/lifts/nope/tag", { tag: "upper" })).status).toBe(404);
  });
});
