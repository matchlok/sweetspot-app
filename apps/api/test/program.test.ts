import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@sweetspot/engine";
import { createApp } from "../src/app";
import { signSession } from "../src/auth";
import { memoryRepo, type StoredGoalChange } from "../src/repo";
import type { Sources } from "../src/sources";
import { memoryLoginStore } from "../src/store";

const SECRET = "x".repeat(48);
const FRI = "2026-11-27T19:00:00Z"; // Friday Nov 27, noon in Denver. The block starts Monday Nov 30.
const AVAIL = [0, 60, 45, 60, 0, 120, 90]; // Mon off, Tue 60, Wed 45, Thu 60, Fri off, Sat 120, Sun 90
const BODY = { availability: { minutes: AVAIL }, purpose: { kind: "faster" } };

/** A fake calendar like the one in calendarWriter.test.ts, with a clock tests can move and a way to make creates fail. */
function setup(opts: { now?: string; goalChanges?: StoredGoalChange[]; events?: CalendarEvent[] } = {}) {
  const events: CalendarEvent[] = opts.events ?? [
    { id: "old-tagged", summary: "Old VO2", start: { date: "2026-12-01" }, extendedProperties: { private: { sweetspotKind: "vo2", sweetspotProgram: "9" } } },
    { id: "hand", summary: "Dentist", start: { date: "2026-12-01" } },
    { id: "legacy", summary: "Endurance — Long Ride (~1.5 hr)", start: { date: "2026-12-05" }, extendedProperties: { private: { sweetspotKind: "endurance" } } },
  ];
  const clock = { now: new Date(opts.now ?? FRI) };
  const fail = { createAfter: Infinity, creates: 0 };
  let n = 0;
  const sources: Sources = {
    events: async (o, nw) => events.filter((e) => e.start.date! >= o && e.start.date! <= nw).map((e) => ({ ...e })),
    activities: async () => [],
    wellness: async () => [],
    patchEvent: async () => {},
    createEvent: async (ev) => {
      if (fail.creates++ >= fail.createAfter) throw new Error("Google Calendar create -> HTTP 500");
      const id = `new${++n}`;
      events.push({ id, summary: ev.summary, start: { date: ev.date }, extendedProperties: { private: ev.tags } });
      return id;
    },
    deleteEvent: async (id) => {
      const i = events.findIndex((e) => e.id === id);
      if (i >= 0) events.splice(i, 1);
    },
  };
  const repo = memoryRepo({ goalChanges: opts.goalChanges });
  const app = createApp({
    env: { JWT_SECRET: SECRET, APP_PASSPHRASE_HASH: `scrypt:1:1:1:${randomBytes(4).toString("base64url")}:x`, CRON_SECRET: "cron" },
    logins: memoryLoginStore(),
    data: { repo, sources, now: () => clock.now },
  });
  return { app, repo, events, clock, fail };
}

type App = ReturnType<typeof setup>["app"];

async function call(app: App, method: string, path: string, body?: unknown) {
  const { token } = await signSession(SECRET);
  const headers: Record<string, string> = { cookie: `sweetspot_session=${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const draft = async (app: App, body: unknown = BODY) => call(app, "POST", "/api/program/draft", body);
const commit = async (app: App, version: string, body: Record<string, unknown> = BODY) => call(app, "POST", "/api/program/commit", { ...body, draftVersion: version });
const cron = (app: App) => app.request("/api/cron/write-week", { headers: { authorization: "Bearer cron" } });
const program = { purpose: "x", raceDate: null, blockWeeks: 8, availability: {}, card: {} };

const tagged = (events: CalendarEvent[]) => events.filter((e) => e.extendedProperties?.private?.sweetspotProgram !== undefined);
const onDate = (events: CalendarEvent[], date: string) => events.filter((e) => e.start.date === date);

describe("POST /api/program/draft", () => {
  it("needs the cookie", async () => {
    const { app } = setup();
    expect((await app.request("/api/program/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(BODY) })).status).toBe(401);
    expect((await app.request("/api/program/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(BODY) })).status).toBe(401);
  });

  it("returns the card, preview, forecast and calendar effect, and writes nothing", async () => {
    const { app, repo, events } = setup();
    const before = JSON.stringify(events);
    const res = await draft(app);
    expect(res.status).toBe(200);
    const d = await res.json();

    expect(d.draftVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(d.history).toEqual({ asOf: "2026-11-27", liftsPerWeek: "unknown" }); // no strength rows stored: never guessed
    expect(d.card.program.startWeek).toBe("2026-11-30");
    expect(d.card.blockWeeks).toBe(8);
    expect(d.preview.weeks.map((w: { start: string }) => w.start)).toEqual(["2026-11-30", "2026-12-07"]);
    expect(d.preview.weeks[0].days).toHaveLength(7);
    expect(d.preview.weeks[0].days[1].sessions[0]).toEqual({ kind: expect.any(String), title: expect.any(String), minutes: expect.any(Number) });
    expect(d.preview.strip).toHaveLength(8);
    expect(d.preview.strip.filter((w: { isRecovery: boolean }) => w.isRecovery)).toHaveLength(2);
    expect(d.forecast.map((f: { key: string }) => f.key)).toEqual(["sweetSpot", "vo2"]);
    expect(d.forecast[0]).toMatchObject({ start: 20, stepMin: 1, ifAllHit: { target: 26 }, atRecentRate: null }); // no judged history yet
    const writes = d.preview.weeks.flatMap((w: { days: { sessions: unknown[] }[] }) => w.days.flatMap((x) => x.sessions)).length;
    expect(d.calendar).toEqual({ from: "2026-11-30", to: "2026-12-13", clears: 1, writes });

    // No Neon, no calendar, no decision row.
    expect(repo.decisionLog).toHaveLength(0);
    expect(await repo.activeProgram()).toBeNull();
    expect(await repo.plannedSessions("2026-01-01", "2027-12-31")).toEqual([]);
    expect(await repo.goalChanges()).toEqual([]);
    expect(await repo.liftTargets()).toEqual([]);
    expect(JSON.stringify(events)).toBe(before);
  });

  it("gives the same version twice and a different one when an input changes", async () => {
    const { app } = setup();
    const a = (await (await draft(app)).json()).draftVersion;
    expect((await (await draft(app)).json()).draftVersion).toBe(a);
    const other = { availability: { minutes: [0, 60, 45, 60, 0, 120, 100] }, purpose: { kind: "faster" } };
    expect((await (await draft(app, other)).json()).draftVersion).not.toBe(a);
  });

  it("derives lifts a week from stored strength activities, else unknown", async () => {
    const { app, repo } = setup();
    // 8 lifts over the 8 full weeks before this one is 1 a week.
    const days = ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29", "2026-11-05", "2026-11-12", "2026-11-19"];
    await repo.upsertActivities(
      days.map((date, i) => ({ id: `s${i}`, date, type: "WeightTraining", source: "strava" as const, raw: { id: `s${i}`, type: "WeightTraining", start_date_local: `${date}T07:00:00Z` } })),
    );
    const d = await (await draft(app)).json();
    expect(d.history.liftsPerWeek).toBe(1);
    expect(d.card.weeks[0].sessions.filter((s: { kind: string }) => s.kind.startsWith("lift"))).toHaveLength(1);
  });

  it("sets each progress goal's start to the target in force and keeps the card's modes", async () => {
    const { app } = setup({ goalChanges: [{ goal: "vo2", effectiveWeek: "2026-11-23", mode: "progress", targetMin: 12, stepMin: 1 }] });
    const race = { availability: { minutes: AVAIL }, purpose: { kind: "race", raceDate: "2026-12-20" } };
    const d = await (await draft(app, race)).json();
    expect(d.card.program.goals.threshold.mode).toBe("progress"); // threshold comes on before a race
    expect(d.card.program.goals.sweetSpot).toMatchObject({ mode: "hold", start: 20 }); // only progress goals are re-started
    expect(d.card.program.goals.vo2).toMatchObject({ mode: "progress", start: 12 }); // the target in force, not the default 8
  });

  it("rejects bad input with 400", async () => {
    const { app } = setup();
    const bad = async (b: unknown) => {
      const res = await draft(app, b);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("invalid");
    };
    await bad({ ...BODY, availability: { minutes: [0, 60, 45, 60, 0, 120] } }); // 6 days
    await bad({ ...BODY, availability: { minutes: [0, 60, 45, 60, 0, 120, 301] } });
    await bad({ ...BODY, availability: { minutes: [0, 60, 45, 60, 0, 120, 1.5] } });
    await bad({ ...BODY, availability: { minutes: [0, 60, 45, 60, 0, 120, -5] } });
    await bad({ ...BODY, purpose: { kind: "marathon" } });
    await bad({ ...BODY, purpose: { kind: "race" } });
    await bad({ ...BODY, purpose: { kind: "race", raceDate: "soon" } });
    await bad({ ...BODY, purpose: { kind: "race", raceDate: "2026-11-29" } }); // before the block starts on Nov 30
    await bad({});
  });

  it("blocks comeback and hold (until SWE-17) and a week the rides don't fit, with 422", async () => {
    const { app } = setup();
    for (const kind of ["comeback", "hold"]) {
      const res = await draft(app, { ...BODY, purpose: { kind } });
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("blocked");
    }
    const res = await draft(app, { ...BODY, availability: { minutes: [0, 0, 0, 0, 0, 0, 60] } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/^availability can't hold/);
  });
});

describe("POST /api/program/commit", () => {
  it("writes the program, sessions, calendar weeks 1 and 2, goals, lifts and one decision row", async () => {
    const { app, repo, events } = setup();
    const d = await (await draft(app)).json();
    const res = await commit(app, d.draftVersion);
    expect(res.status).toBe(200);
    const out = await res.json();

    // (b) Neon holds the whole block, with the draft version and forecast in the card JSON.
    const active = await repo.activeProgram();
    expect(out.programId).toBe(active!.id);
    expect(active).toMatchObject({ purpose: "faster", blockWeeks: 8, status: "active" });
    expect(active!.card).toMatchObject({ draftVersion: d.draftVersion, forecast: d.forecast });
    const all = await repo.plannedSessions("2026-11-30", "2027-03-01");
    expect(all).toHaveLength(d.card.weeks.reduce((n: number, w: { sessions: unknown[] }) => n + w.sessions.length, 0));

    // (c) Weeks 1 and 2 are on the calendar, one tagged event per session; weeks after that are not.
    expect(out.written).toEqual([
      { oldest: "2026-11-30", newest: "2026-12-06", deleted: 1, created: d.card.weeks[0].sessions.length },
      { oldest: "2026-12-07", newest: "2026-12-13", deleted: 0, created: d.card.weeks[1].sessions.length },
    ]);
    const mine = tagged(events);
    expect(mine).toHaveLength(d.calendar.writes);
    expect(mine.every((e) => e.extendedProperties!.private!.sweetspotProgram === String(out.programId))).toBe(true);
    expect(mine.every((e) => e.start.date! >= "2026-11-30" && e.start.date! <= "2026-12-13")).toBe(true);
    expect(all.filter((s) => s.calendarEventId !== null)).toHaveLength(d.calendar.writes);
    // Untagged events survive; the old tagged one in the block's weeks is gone.
    expect(events.map((e) => e.id)).toEqual(expect.arrayContaining(["hand", "legacy"]));
    expect(events.map((e) => e.id)).not.toContain("old-tagged");

    // (d) Goals at block week 1, lifts from the generator's pick (unknown history: 2 lifts, one lower and one upper).
    expect((await repo.goalChanges()).map((g) => [g.goal, g.effectiveWeek, g.mode, g.targetMin, g.stepMin])).toEqual([
      ["endurance", "2026-11-30", "hold", 90, 0],
      ["sweetSpot", "2026-11-30", "progress", 20, 1],
      ["threshold", "2026-11-30", "off", 10, 1],
      ["vo2", "2026-11-30", "progress", 8, 1],
    ]);
    expect(await repo.liftTargets()).toEqual([{ effectiveWeek: "2026-11-30", upper: 1, lower: 1 }]);

    // (e) One applied decision with the card, forecast and calendar changes.
    expect(repo.decisionLog).toHaveLength(1);
    const row = repo.decisionLog[0]!;
    expect(row).toMatchObject({ trigger: "program_commit", status: "applied" });
    expect(row.inputs).toEqual({ asOf: "2026-11-27", history: d.history, availability: BODY.availability, purpose: BODY.purpose, draftVersion: d.draftVersion });
    expect(row.choice).toMatchObject({ programId: out.programId, blockWeeks: 8, forecast: d.forecast, assumptions: d.card.assumptions });
    expect((row.choice as { weeklyTemplate: unknown[] }).weeklyTemplate.length).toBeGreaterThan(0);
    expect(row.ruleResults).toEqual({ planViolations: expect.any(Array) });
    expect(row.calendarChanges).toEqual({ weeks: out.written, archivedProgramId: null });

    // The response carries block week 1, and GET /api/week shows the same sessions.
    expect(out.week.start).toBe("2026-11-30");
    // Hand-made events (the Dentist, the legacy ride) show in the week too, so count the app's sessions only.
    const count = (w: { days: { sessions: { title: string }[] }[] }) => w.days.reduce((n, x) => n + x.sessions.filter((s) => /\(\d+ min\)$/.test(s.title)).length, 0);
    expect(count(out.week)).toBe(d.card.weeks[0].sessions.length);
    const wk = await (await call(app, "GET", "/api/week?start=2026-11-30")).json();
    expect(count(wk)).toBe(d.card.weeks[0].sessions.length);
    expect(wk.days[1].sessions.length).toBeGreaterThan(0);
  });

  it("never trusts the client: a stale or made-up draftVersion is a 409, logged, and writes nothing", async () => {
    const { app, repo, events } = setup();
    const before = JSON.stringify(events);
    const res = await commit(app, "deadbeefdeadbeef");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
    // A real version for different availability is stale too.
    const other = { availability: { minutes: [0, 60, 45, 60, 0, 120, 100] }, purpose: { kind: "faster" } };
    const v = (await (await draft(app, other)).json()).draftVersion;
    expect((await commit(app, v)).status).toBe(409);
    expect(await repo.activeProgram()).toBeNull();
    expect(JSON.stringify(events)).toBe(before);
    expect(repo.decisionLog.map((r) => r.status)).toEqual(["blocked", "blocked"]);
  });

  it("maps invalid and blocked requests the same way the draft does", async () => {
    const { app, repo } = setup();
    expect((await commit(app, "x", { ...BODY, purpose: { kind: "race" } })).status).toBe(400);
    expect((await call(app, "POST", "/api/program/commit", BODY)).status).toBe(400); // no draftVersion
    expect((await commit(app, "x", { ...BODY, purpose: { kind: "comeback" } })).status).toBe(422);
    const tooTight = await commit(app, "x", { ...BODY, availability: { minutes: [0, 0, 0, 0, 0, 0, 60] } });
    expect(tooTight.status).toBe(422);
    expect((await tooTight.json()).error.message).toMatch(/^availability can't hold/);
    expect(repo.decisionLog.map((r) => r.status)).toEqual(["blocked", "blocked"]); // 400s are not logged
    expect(await repo.activeProgram()).toBeNull();
  });

  it("answers 502 when the calendar fails, keeps the program, logs failed, and a retry only re-runs the calendar", async () => {
    const { app, repo, events, fail } = setup();
    const d = await (await draft(app)).json();
    fail.createAfter = 3; // the fourth create fails

    const res = await commit(app, d.draftVersion);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "upstream", message: "Program saved; calendar not fully written. Retry." } });
    const first = await repo.activeProgram();
    expect(first).not.toBeNull();
    expect(repo.decisionLog.map((r) => r.status)).toEqual(["failed"]);
    expect(repo.decisionLog[0]!.calendarChanges).toMatchObject({ error: expect.stringContaining("HTTP 500") });
    expect(tagged(events).length).toBe(3);

    fail.createAfter = Infinity;
    const retry = await commit(app, d.draftVersion);
    expect(retry.status).toBe(200);
    const out = await retry.json();
    expect(out.programId).toBe(first!.id); // no second program
    expect((await repo.plannedSessions("2026-11-30", "2027-03-01")).length).toBe(d.card.weeks.reduce((n: number, w: { sessions: unknown[] }) => n + w.sessions.length, 0));
    expect(tagged(events)).toHaveLength(d.calendar.writes); // the partial week was replaced, not doubled
    expect(repo.decisionLog.map((r) => r.status)).toEqual(["failed", "applied"]);
    expect(await repo.goalChanges()).toHaveLength(4); // written once

    // Same draft again while it is active: still no second program, still no duplicates.
    expect((await commit(app, d.draftVersion)).status).toBe(200);
    expect(tagged(events)).toHaveLength(d.calendar.writes);
    expect(await repo.goalChanges()).toHaveLength(4);
  });

  it("a rebuild archives the old program, deletes its future sessions and removes its future events", async () => {
    const { app, repo, events } = setup();
    // An older program: one session before the block (kept, archived) and two in the block's weeks.
    const old = await repo.createProgram(program, [
      { date: "2026-11-25", kind: "endurance", minutes: 90 },
      { date: "2026-12-01", kind: "vo2", minutes: 60 },
      { date: "2026-12-08", kind: "vo2", minutes: 60 },
    ]);
    const first = await (await draft(app)).json();
    const a = await (await commit(app, first.draftVersion)).json();
    expect(a.programId).not.toBe(old.program.id);

    const oldRow = (await repo.activeProgram())!;
    expect(oldRow.id).toBe(a.programId);
    expect(repo.decisionLog[0]!.calendarChanges).toMatchObject({ archivedProgramId: old.program.id });
    // Only the active program's sessions are returned; the old program's are gone from the block's weeks.
    const sessions = await repo.plannedSessions("2026-11-01", "2027-03-01");
    expect(sessions.every((s) => s.programId === a.programId)).toBe(true);
    expect(sessions.some((s) => s.date === "2026-11-25")).toBe(false); // archived, so hidden

    // Rebuild with different availability.
    const next = { availability: { minutes: [0, 60, 45, 60, 0, 120, 100] }, purpose: { kind: "faster" } };
    const second = await (await draft(app, next)).json();
    const b = await (await commit(app, second.draftVersion, next)).json();
    expect(b.programId).not.toBe(a.programId);
    expect(repo.decisionLog[1]!.calendarChanges).toMatchObject({ archivedProgramId: a.programId });
    const now = await repo.plannedSessions("2026-11-30", "2027-03-01");
    expect(now.every((s) => s.programId === b.programId)).toBe(true);
    // The calendar holds only the new program's events; the first program's are gone.
    expect(tagged(events).every((e) => e.extendedProperties!.private!.sweetspotProgram === String(b.programId))).toBe(true);
    expect(tagged(events)).toHaveLength(second.calendar.writes);
    expect(events.map((e) => e.id)).toEqual(expect.arrayContaining(["hand", "legacy"]));
  });

  it("keeps progress: goal changes carry the target in force and the card's modes", async () => {
    const { app, repo } = setup({ goalChanges: [{ goal: "vo2", effectiveWeek: "2026-11-23", mode: "progress", targetMin: 12, stepMin: 1 }] });
    const d = await (await draft(app)).json();
    expect(d.card.program.goals.vo2.start).toBe(12);
    await commit(app, d.draftVersion);
    const mine = (await repo.goalChanges()).filter((g) => g.effectiveWeek === "2026-11-30" && g.goal === "vo2");
    expect(mine).toEqual([{ goal: "vo2", effectiveWeek: "2026-11-30", mode: "progress", targetMin: 12, stepMin: 1 }]);
  });
});

describe("Sunday cron after a commit", () => {
  it("commit on Fri Nov 27 writes Nov 30 and Dec 7; cron Sun Nov 29 rewrites Dec 7 without duplicates; cron Sun Dec 6 writes Dec 14", async () => {
    const { app, repo, events, clock } = setup();
    const d = await (await draft(app)).json();
    await commit(app, d.draftVersion);
    const weekCount = (i: number) => d.card.weeks[i].sessions.length;
    expect(onDate(tagged(events), "2026-12-14")).toHaveLength(0);
    expect(tagged(events)).toHaveLength(weekCount(0) + weekCount(1));

    clock.now = new Date("2026-11-30T05:00:00Z"); // Sunday Nov 29, 22:00 in Denver
    expect(await (await cron(app)).json()).toMatchObject({ oldest: "2026-12-07", newest: "2026-12-13", deleted: weekCount(1), created: weekCount(1) });
    expect(tagged(events)).toHaveLength(weekCount(0) + weekCount(1));

    clock.now = new Date("2026-12-07T05:00:00Z"); // Sunday Dec 6
    expect(await (await cron(app)).json()).toMatchObject({ oldest: "2026-12-14", newest: "2026-12-20", created: weekCount(2) });
    expect(tagged(events)).toHaveLength(weekCount(0) + weekCount(1) + weekCount(2));
    expect((await repo.plannedSessions("2026-12-14", "2026-12-20")).every((s) => s.calendarEventId !== null)).toBe(true);
  });

  it("writes only the active program, never an archived one's sessions", async () => {
    const { app, repo, events, clock } = setup({ events: [] });
    const old = await repo.createProgram(program, [{ date: "2026-12-14", kind: "vo2", minutes: 60 }]);
    await repo.archiveProgram(old.program.id);
    clock.now = new Date("2026-12-07T05:00:00Z");
    expect(await (await cron(app)).json()).toMatchObject({ oldest: "2026-12-14", created: 0 });
    expect(events).toHaveLength(0);
  });

  it("a commit on a Sunday after the cron ran leaves no gap and no duplicate", async () => {
    // The old program's cron already wrote Dec 7 that Sunday.
    const events: CalendarEvent[] = [
      { id: "old-dec7", summary: "Old", start: { date: "2026-12-08" }, extendedProperties: { private: { sweetspotKind: "vo2", sweetspotProgram: "9" } } },
    ];
    const { app, events: cal } = setup({ now: "2026-11-30T05:00:00Z", events }); // Sunday Nov 29, 22:00 in Denver
    const d = await (await draft(app)).json();
    expect(d.card.program.startWeek).toBe("2026-11-30"); // tomorrow
    await commit(app, d.draftVersion);
    expect(tagged(cal)).toHaveLength(d.calendar.writes);
    expect(cal.map((e) => e.id)).not.toContain("old-dec7");
    expect(onDate(tagged(cal), "2026-11-30").length).toBeGreaterThan(0);
  });

  it("a commit on a Monday starts the block the next Monday and leaves this week alone", async () => {
    const events: CalendarEvent[] = [
      { id: "this-week", summary: "Old", start: { date: "2026-12-02" }, extendedProperties: { private: { sweetspotKind: "vo2", sweetspotProgram: "9" } } },
      { id: "old-dec7", summary: "Old", start: { date: "2026-12-08" }, extendedProperties: { private: { sweetspotKind: "vo2", sweetspotProgram: "9" } } },
    ];
    const { app, events: cal } = setup({ now: "2026-11-30T19:00:00Z", events });
    const d = await (await draft(app)).json();
    expect(d.card.program.startWeek).toBe("2026-12-07");
    await commit(app, d.draftVersion);
    const ids = cal.map((e) => e.id);
    expect(ids).toContain("this-week"); // the current week is not touched
    expect(ids).not.toContain("old-dec7"); // replaced, not duplicated
    expect(tagged(cal).filter((e) => e.id !== "this-week")).toHaveLength(d.calendar.writes);
    expect(Math.min(...tagged(cal).filter((e) => e.id.startsWith("new")).map((e) => Date.parse(e.start.date!)))).toBe(Date.parse("2026-12-07"));
  });
});
