import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, IntervalsActivity } from "@sweetspot/engine";
import { createApp } from "../src/app";
import { scoreReadiness } from "../src/data";
import { signSession } from "../src/auth";
import { memoryRepo } from "../src/repo";
import type { Sources } from "../src/sources";
import { memoryLoginStore } from "../src/store";

const SECRET = "x".repeat(48);
const events: CalendarEvent[] = [
  { id: "vo2-1110", summary: "VO2 Max Intervals — Trail (~1 hr)", start: { date: "2026-11-10" } },
  { id: "end-1114", summary: "Endurance — Long Ride (~1.5 hr)", start: { date: "2026-11-14" } },
];

function setup(activities: IntervalsActivity[] = []) {
  let at = new Date("2026-11-10T14:00:00Z"); // 7 am Denver
  const sources: Sources = {
    events: async () => events,
    activities: async () => activities,
    wellness: async () => [{ id: "2026-11-10", ctl: 40, atl: 56, rampRate: 3 }],
    patchEvent: async () => {},
  };
  const repo = memoryRepo();
  const data = { repo, sources, now: () => at };
  const app = createApp({
    env: { JWT_SECRET: SECRET, APP_PASSPHRASE_HASH: `scrypt:1:1:1:${randomBytes(4).toString("base64url")}:x`, CRON_SECRET: "cron" },
    logins: memoryLoginStore(),
    data,
  });
  const home = async () => {
    const { token } = await signSession(SECRET);
    return (await app.request("/api/home", { headers: { cookie: `sweetspot_session=${token}` } })).json();
  };
  return { repo, data, home, setNow: (d: Date) => (at = d) };
}

describe("readiness log", () => {
  it("returns the pill and logs one reading a day with its prediction", async () => {
    const { repo, home } = setup();
    const h = await home();
    // Form is -16, so yellow.
    expect(h.readiness).toMatchObject({ light: "yellow", label: "Take care today", provisional: true });
    await home();
    const log = repo.decisionLog.filter((d) => d.trigger === "readiness_reading");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      status: "applied",
      inputs: { date: "2026-11-10", version: expect.any(String) },
      choice: { date: "2026-11-10", light: "yellow", sessionId: "vo2-1110", kind: "vo2", expect: "shortfall" },
    });
  });

  it("scores the reading once the day is over, and only once", async () => {
    // A ride with 4 min in Z5 on Nov 10: short of the 8 min target, so a shortfall, which yellow predicted.
    const ride: IntervalsActivity = {
      id: "a1",
      type: "Ride",
      start_date_local: "2026-11-10T07:30:00",
      moving_time: 3600,
      device_watts: true,
      icu_zone_times: [{ id: "Z1", secs: 600 }, { id: "Z2", secs: 2400 }, { id: "Z3", secs: 300 }, { id: "Z4", secs: 0 }, { id: "Z5", secs: 240 }, { id: "Z6", secs: 0 }, { id: "Z7", secs: 0 }],
    };
    const { repo, data, home, setNow } = setup([ride]);
    await home();
    expect(await scoreReadiness(data)).toBe(0); // the day isn't over

    setNow(new Date("2026-11-11T14:00:00Z"));
    expect(await scoreReadiness(data)).toBe(1);
    expect(await scoreReadiness(data)).toBe(0);
    const scored = repo.decisionLog.filter((d) => d.trigger === "readiness_scored");
    expect(scored).toHaveLength(1);
    expect(scored[0]!.choice).toMatchObject({
      outcome: { date: "2026-11-10", done: true, completed: false, goalMinutes: 4 },
      score: { correct: true, predicted: "shortfall", actual: "shortfall" },
    });
  });
});
