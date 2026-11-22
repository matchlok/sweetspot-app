import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@sweetspot/engine";
import { createApp } from "../src/app";
import { targetWeek } from "../src/calendarWriter";
import { memoryRepo } from "../src/repo";
import type { Sources } from "../src/sources";
import { memoryLoginStore } from "../src/store";

/** A fake calendar: create and delete act on a list, events() filters by date. */
function setup(now: Date) {
  const events: CalendarEvent[] = [
    { id: "old-tagged", summary: "Old VO2", start: { date: "2026-11-30" }, extendedProperties: { private: { sweetspotKind: "vo2", sweetspotProgram: "1" } } },
    { id: "hand", summary: "Dentist", start: { date: "2026-12-01" } },
    { id: "legacy", summary: "Endurance — Long Ride (~1.5 hr)", start: { date: "2026-12-05" }, extendedProperties: { private: { sweetspotKind: "endurance" } } },
    { id: "tagged-other-week", summary: "Later", start: { date: "2026-12-08" }, extendedProperties: { private: { sweetspotProgram: "1" } } },
  ];
  let n = 0;
  const sources: Sources = {
    events: async (o, nw) => events.filter((e) => e.start.date! >= o && e.start.date! <= nw).map((e) => ({ ...e })),
    activities: async () => [],
    wellness: async () => [],
    patchEvent: async () => {},
    createEvent: async (ev) => {
      const id = `new${++n}`;
      events.push({ id, summary: ev.summary, start: { date: ev.date }, extendedProperties: { private: ev.tags } });
      return id;
    },
    deleteEvent: async (id) => {
      const i = events.findIndex((e) => e.id === id);
      if (i >= 0) events.splice(i, 1);
    },
  };
  const repo = memoryRepo();
  const app = createApp({
    env: { JWT_SECRET: "x".repeat(48), APP_PASSPHRASE_HASH: `scrypt:1:1:1:${randomBytes(4).toString("base64url")}:x`, CRON_SECRET: "cron" },
    logins: memoryLoginStore(),
    data: { repo, sources, now: () => now },
  });
  return { app, repo, events };
}

const run = (app: ReturnType<typeof setup>["app"], auth = "Bearer cron") => app.request("/api/cron/write-week", { headers: { authorization: auth } });
const program = { purpose: "x", raceDate: null, blockWeeks: 8, availability: {}, card: {} };

describe("targetWeek", () => {
  it("is Monday to Sunday two weeks after this week, by the Denver date", () => {
    // Sunday Nov 22 22:00 MST is already Monday Nov 23 05:00 UTC: still Sunday in Denver.
    expect(targetWeek(new Date("2026-11-23T05:00:00Z"))).toEqual({ oldest: "2026-11-30", newest: "2026-12-06" });
    // Sunday Nov 29 -> the week of Dec 7.
    expect(targetWeek(new Date("2026-11-30T05:00:00Z"))).toEqual({ oldest: "2026-12-07", newest: "2026-12-13" });
    // Monday Nov 23 in Denver (07:00 UTC) moves the target forward a week.
    expect(targetWeek(new Date("2026-11-23T07:00:00Z"))).toEqual({ oldest: "2026-12-07", newest: "2026-12-13" });
  });
});

describe("cron write-week", () => {
  it("needs the cron secret", async () => {
    const { app } = setup(new Date("2026-11-23T05:00:00Z"));
    expect((await run(app, "Bearer nope")).status).toBe(401);
  });

  it("writes the target week only, tagged, and records event ids", async () => {
    const { app, repo, events } = setup(new Date("2026-11-23T05:00:00Z"));
    const { sessions } = await repo.createProgram(program, [
      { date: "2026-11-30", kind: "vo2", minutes: 60, title: "VO2 Max Intervals" },
      { date: "2026-12-02", kind: "lift_lower", minutes: 40 },
      { date: "2026-12-07", kind: "endurance", minutes: 90 }, // next week: not written yet
      { date: "2026-11-25", kind: "endurance", minutes: 90 }, // this week: not written
    ]);
    const res = await run(app);
    expect(await res.json()).toMatchObject({ oldest: "2026-11-30", newest: "2026-12-06", created: 2 });
    const made = events.filter((e) => e.id.startsWith("new"));
    expect(made.map((e) => [e.start.date, e.summary, e.extendedProperties?.private])).toEqual([
      ["2026-11-30", "VO2 Max Intervals", { sweetspotKind: "vo2", sweetspotProgram: "1" }],
      ["2026-12-02", "lift_lower", { sweetspotKind: "lift_lower", sweetspotProgram: "1" }],
    ]);
    const stored = await repo.plannedSessions("2026-11-30", "2026-12-06");
    expect(stored.map((s) => s.calendarEventId)).toEqual(["new1", "new2"]);
    expect(sessions).toHaveLength(4);
  });

  it("rebuild deletes only events tagged sweetspotProgram in the week", async () => {
    const { app, repo, events } = setup(new Date("2026-11-23T05:00:00Z"));
    await repo.createProgram(program, [{ date: "2026-11-30", kind: "vo2", minutes: 60 }]);
    const res = await run(app);
    expect(await res.json()).toMatchObject({ deleted: 1, created: 1 });
    const ids = events.map((e) => e.id);
    expect(ids).not.toContain("old-tagged");
    // Untagged, kind-only (not program) and other-week events survive.
    expect(ids).toEqual(expect.arrayContaining(["hand", "legacy", "tagged-other-week"]));
  });

  it("is repeatable: a second run replaces rather than duplicates", async () => {
    const { app, repo, events } = setup(new Date("2026-11-23T05:00:00Z"));
    await repo.createProgram(program, [{ date: "2026-11-30", kind: "vo2", minutes: 60 }]);
    await run(app);
    await run(app);
    expect(events.filter((e) => e.extendedProperties?.private?.sweetspotProgram === "1" && e.start.date === "2026-11-30")).toHaveLength(1);
  });
});
