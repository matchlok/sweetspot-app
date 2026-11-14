import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, IntervalsActivity } from "@sweetspot/engine";
import { createApp } from "../src/app";
import { signSession } from "../src/auth";
import { memoryRepo } from "../src/repo";
import type { Sources } from "../src/sources";
import { memoryLoginStore } from "../src/store";

const SECRET = "x".repeat(48);
const events: CalendarEvent[] = [
  { id: "lift-b-1109", summary: "Lift B — Upper Body", start: { date: "2026-11-09" } },
  { id: "vo2-1110", summary: "VO2 Max Intervals — Trail (~1 hr)", start: { date: "2026-11-10" } },
  { id: "lift-a-1112", summary: "Lift A — Lower Body + Core", start: { date: "2026-11-12" } },
  { id: "end-1114", summary: "Endurance — Long Ride (~1.5 hr)", start: { date: "2026-11-14" } },
];
const rideRaw: IntervalsActivity = {
  id: "a1",
  type: "Ride",
  start_date_local: "2026-11-07T09:00:00",
  moving_time: 5400,
  icu_hr_zone_times: [600, 3000, 1200, 600, 0, 0, 0],
};

function setup() {
  const calls = { activities: 0 };
  const sources: Sources = {
    events: async () => events,
    activities: async () => {
      calls.activities++;
      return [rideRaw];
    },
    wellness: async () => [],
  };
  const repo = memoryRepo();
  // Tuesday Nov 10, 2026, noon in Denver.
  const now = () => new Date("2026-11-10T19:00:00Z");
  const app = createApp({
    env: { JWT_SECRET: SECRET, APP_PASSPHRASE_HASH: `scrypt:1:1:1:${randomBytes(4).toString("base64url")}:x`, CRON_SECRET: "cron" },
    logins: memoryLoginStore(),
    data: { repo, sources, now },
  });
  return { app, repo, calls };
}

async function authed(app: ReturnType<typeof setup>["app"], path: string, init: RequestInit = {}) {
  const { token } = await signSession(SECRET);
  return app.request(path, { ...init, headers: { ...(init.headers as object), cookie: `sweetspot_session=${token}` } });
}

describe("read routes", () => {
  it("needs the cookie", async () => {
    expect((await setup().app.request("/api/home")).status).toBe(401);
  });

  it("serves Home for the day, syncing first", async () => {
    const { app, calls, repo } = setup();
    const res = await authed(app, "/api/home");
    expect(res.status).toBe(200);
    const home = await res.json();
    expect(home.date).toBe("2026-11-10");
    expect(home.today.kind).toBe("vo2");
    expect(home.goals.length).toBeGreaterThan(0);
    expect(calls.activities).toBe(1);
    expect(repo.activitiesStore.size).toBe(1);
    // Fresh now, so a second read doesn't sync again.
    await authed(app, "/api/home");
    expect(calls.activities).toBe(1);
  });

  it("serves the week, program and a goal", async () => {
    const { app } = setup();
    const week = await (await authed(app, "/api/week")).json();
    expect(week.start).toBe("2026-11-09");
    expect(week.days).toHaveLength(7);
    expect((await authed(app, "/api/program")).status).toBe(200);
    const goal = await (await authed(app, "/api/goals/sweetSpot")).json();
    expect(goal.key).toBe("sweetSpot");
    const prev = await (await authed(app, "/api/goals/vo2/preview?mode=progress&target=8&stepMin=1")).json();
    expect(prev.preview.length).toBeGreaterThan(0);
  });

  it("returns options for a real session and 404 for an unknown one", async () => {
    const { app } = setup();
    const ok = await authed(app, "/api/sessions/vo2-1110/options?action=move");
    expect(ok.status).toBe(200);
    expect((await ok.json()).planVersion).toBeTruthy();
    expect((await authed(app, "/api/sessions/nope/options?action=move")).status).toBe(404);
    expect((await authed(app, "/api/sessions/vo2-1110/options?action=fly")).status).toBe(400);
  });

  it("rejects bad input", async () => {
    const { app } = setup();
    expect((await authed(app, "/api/home?date=tomorrow")).status).toBe(400);
    expect((await authed(app, "/api/goals/bogus")).status).toBe(404);
    expect((await authed(app, "/api/goals/vo2/preview?mode=progress")).status).toBe(400);
  });

  it("syncs on demand and from cron, idempotently", async () => {
    const { app, repo } = setup();
    const first = await (await authed(app, "/api/sync", { method: "POST" })).json();
    expect(first.newActivities).toBe(1);
    const again = await (await authed(app, "/api/sync", { method: "POST" })).json();
    expect(again.newActivities).toBe(0);
    expect(repo.activitiesStore.size).toBe(1);
    const cron = await app.request("/api/cron/sync", { headers: { authorization: "Bearer cron" } });
    expect(cron.status).toBe(200);
  });
});
