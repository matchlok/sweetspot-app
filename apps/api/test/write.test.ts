import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@sweetspot/engine";
import { createApp } from "../src/app";
import { signSession } from "../src/auth";
import type { EventPatch } from "../src/google";
import { memoryRepo } from "../src/repo";
import type { Sources } from "../src/sources";
import { memoryLoginStore } from "../src/store";

const SECRET = "x".repeat(48);

/** Tuesday Nov 10, 2026: VO2 today, Monday's upper lift not logged, lower lift Thursday, long ride Saturday. */
function seedEvents(): CalendarEvent[] {
  return [
    { id: "lift-b-1109", summary: "Lift B — Upper Body", start: { date: "2026-11-09" } },
    { id: "vo2-1110", summary: "VO2 Max Intervals — Trail (~1 hr)", start: { date: "2026-11-10" } },
    { id: "lift-a-1112", summary: "Lift A — Lower Body + Core", start: { date: "2026-11-12" } },
    { id: "end-1114", summary: "Endurance — Long Ride (~1.5 hr)", start: { date: "2026-11-14" } },
    { id: "vo2-1117", summary: "VO2 Max Intervals — Trail (~1 hr)", start: { date: "2026-11-17" } },
    { id: "end-1121", summary: "Endurance — Long Ride (~1.5 hr)", start: { date: "2026-11-21" } },
  ];
}

function setup(opts: { failOn?: (id: string, patch: EventPatch) => boolean } = {}) {
  const events = seedEvents();
  const patches: { id: string; patch: EventPatch }[] = [];
  const sources: Sources = {
    events: async () => events.map((e) => ({ ...e })),
    activities: async () => [],
    wellness: async () => [],
    // Behaves like Google: a date patch moves the instance, a cancel marks it cancelled.
    patchEvent: async (id, patch) => {
      if (opts.failOn?.(id, patch)) throw new Error("Google Calendar patch -> HTTP 500");
      patches.push({ id, patch });
      const e = events.find((x) => x.id === id)!;
      if (patch.date) {
        e.originalStartTime ??= { date: e.start.date! }; // Google keeps where an instance started
        e.start = { date: patch.date };
      }
      if (patch.status) e.status = patch.status;
      if (patch.tags) e.extendedProperties = { private: { ...e.extendedProperties?.private, ...patch.tags } };
    },
  };
  const repo = memoryRepo();
  const now = () => new Date("2026-11-10T19:00:00Z");
  const app = createApp({
    env: { JWT_SECRET: SECRET, APP_PASSPHRASE_HASH: `scrypt:1:1:1:${randomBytes(4).toString("base64url")}:x`, CRON_SECRET: "cron" },
    logins: memoryLoginStore(),
    data: { repo, sources, now },
  });
  return { app, repo, patches, events };
}

type App = ReturnType<typeof setup>["app"];

async function call(app: App, method: string, path: string, body?: unknown) {
  const { token } = await signSession(SECRET);
  const headers: Record<string, string> = { cookie: `sweetspot_session=${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function options(app: App, id: string, action: string) {
  return (await call(app, "GET", `/api/sessions/${id}/options?action=${action}`)).json();
}

describe("apply: move, swap, skip", () => {
  it("needs the cookie and a JSON body", async () => {
    const { app } = setup();
    expect((await app.request("/api/sessions/vo2-1110/apply", { method: "POST" })).status).toBe(401);
    const res = await call(app, "POST", "/api/sessions/vo2-1110/apply", { action: "move" });
    expect(res.status).toBe(400);
  });

  it("moves a session, pulls the lower lift out of the way, and logs one decision", async () => {
    const { app, repo, patches } = setup();
    const opts = await options(app, "vo2-1110", "move");
    // Friday puts VO2 the day after the Thursday lower lift, so the lift moves too.
    const fri = opts.options.find((o: { id: string }) => o.id === "move:2026-11-13");
    expect(fri.alsoMoves).toHaveLength(1);

    const res = await call(app, "POST", "/api/sessions/vo2-1110/apply", { action: "move", optionId: fri.id, planVersion: opts.planVersion });
    expect(res.status).toBe(200);
    const out = await res.json();

    expect(patches).toHaveLength(2);
    expect(patches[0]).toMatchObject({ id: "vo2-1110", patch: { date: "2026-11-13" } });
    expect(patches[1]!.id).toBe("lift-a-1112");

    const log = repo.decisionLog;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ trigger: "apply_move", status: "applied" });
    // Each written instance carries its kind and the decision id.
    expect(patches[0]!.patch.tags).toEqual({ sweetspotKind: "vo2", sweetspotDecisionId: String(log[0]!.id) });

    const vo2Day = out.week.days.find((d: { sessions: { id: string }[] }) => d.sessions.some((s) => s.id === "vo2-1110"));
    expect(vo2Day.date).toBe("2026-11-13");
    expect(out.home.today).toBeNull(); // Tuesday is open now
  });

  it("swaps two sessions", async () => {
    const { app, patches } = setup();
    const opts = await options(app, "vo2-1110", "swap");
    const first = opts.options[0];
    expect(first).toBeDefined();
    const res = await call(app, "POST", "/api/sessions/vo2-1110/apply", { action: "swap", optionId: first.id, planVersion: opts.planVersion });
    expect(res.status).toBe(200);
    expect(patches.map((p) => p.id).sort()).toEqual(["vo2-1110", first.id.slice("swap:".length)].sort());
  });

  it("skips by cancelling the one instance", async () => {
    const { app, patches, repo } = setup();
    const opts = await options(app, "vo2-1110", "skip");
    const res = await call(app, "POST", "/api/sessions/vo2-1110/apply", { action: "skip", optionId: "skip", planVersion: opts.planVersion });
    expect(res.status).toBe(200);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.patch.status).toBe("cancelled");
    expect(patches[0]!.patch.date).toBeUndefined();
    expect(repo.decisionLog[0]!.status).toBe("applied");
  });

  it("refuses a stale plan version with 409 and writes nothing", async () => {
    const { app, patches, repo } = setup();
    const opts = await options(app, "vo2-1110", "move");
    const res = await call(app, "POST", "/api/sessions/vo2-1110/apply", { action: "move", optionId: opts.options[0].id, planVersion: "00000000" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
    expect(patches).toHaveLength(0);
    expect(repo.decisionLog).toHaveLength(0);
  });

  it("refuses an option the rules don't offer and logs it as blocked", async () => {
    const { app, patches, repo } = setup();
    const opts = await options(app, "vo2-1110", "move");
    // Yesterday is in the past, so no option exists for it.
    const res = await call(app, "POST", "/api/sessions/vo2-1110/apply", { action: "move", optionId: "move:2026-11-09", planVersion: opts.planVersion });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("blocked");
    expect(patches).toHaveLength(0);
    expect(repo.decisionLog.map((d) => d.status)).toEqual(["blocked"]);
  });

  it("404s on an unknown session and 400s on a bad body", async () => {
    const { app } = setup();
    expect((await call(app, "POST", "/api/sessions/nope/apply", { action: "skip", optionId: "skip", planVersion: "x" })).status).toBe(404);
    expect((await call(app, "POST", "/api/sessions/vo2-1110/apply", { action: "fly", optionId: "a", planVersion: "x" })).status).toBe(400);
  });

  it("undoes the first change when the second fails, and logs the failure", async () => {
    const { app, repo, patches, events } = setup({ failOn: (id, p) => id === "lift-a-1112" && p.date !== undefined });
    const opts = await options(app, "vo2-1110", "move");
    const res = await call(app, "POST", "/api/sessions/vo2-1110/apply", { action: "move", optionId: "move:2026-11-13", planVersion: opts.planVersion });
    expect(res.status).toBe(502);
    // VO2 moved, then moved back.
    expect(patches.map((p) => `${p.id}:${p.patch.date}`)).toEqual(["vo2-1110:2026-11-13", "vo2-1110:2026-11-10"]);
    expect(events.find((e) => e.id === "vo2-1110")!.start.date).toBe("2026-11-10");
    expect(repo.decisionLog).toHaveLength(1);
    expect(repo.decisionLog[0]!.status).toBe("failed");
  });
});

describe("mark done", () => {
  it("marks Monday's unlogged lift done, then undoes it", async () => {
    const { app, repo } = setup();
    const before = await (await call(app, "GET", "/api/home")).json();
    expect(before.strength.upper.actual).toBe(0);

    const res = await call(app, "POST", "/api/sessions/lift-b-1109/done");
    expect(res.status).toBe(200);
    const { home } = await res.json();
    expect(home.strength.upper.actual).toBe(1);
    expect(repo.decisionLog.map((d) => d.trigger)).toEqual(["mark_done"]);

    // Marking twice is harmless.
    expect((await call(app, "POST", "/api/sessions/lift-b-1109/done")).status).toBe(200);
    expect(repo.decisionLog).toHaveLength(1);

    const undo = await call(app, "DELETE", "/api/sessions/lift-b-1109/done");
    expect(undo.status).toBe(200);
    expect((await undo.json()).home.strength.upper.actual).toBe(0);
    expect((await call(app, "DELETE", "/api/sessions/lift-b-1109/done")).status).toBe(404);
  });

  it("refuses rides and lifts still ahead", async () => {
    const { app, repo } = setup();
    expect((await call(app, "POST", "/api/sessions/vo2-1110/done")).status).toBe(422);
    expect((await call(app, "POST", "/api/sessions/lift-a-1112/done")).status).toBe(422);
    expect((await call(app, "POST", "/api/sessions/nope/done")).status).toBe(404);
    expect(repo.decisionLog).toHaveLength(0);
  });
});

describe("settings", () => {
  it("saves a goal from the current week and returns the new view", async () => {
    const { app, repo } = setup();
    const res = await call(app, "PUT", "/api/goals/sweetSpot", { mode: "hold", target: 25, stepMin: 2 });
    expect(res.status).toBe(200);
    const goal = await res.json();
    expect(goal).toMatchObject({ key: "sweetSpot", mode: "hold", target: 25, stepMin: 2 });
    expect((await repo.goalChanges())[0]).toMatchObject({ goal: "sweetSpot", effectiveWeek: "2026-11-09", mode: "hold", targetMin: 25 });
    expect(repo.decisionLog.map((d) => d.trigger)).toEqual(["set_goal"]);
    // The read route sees it too.
    expect((await (await call(app, "GET", "/api/goals/sweetSpot")).json()).mode).toBe("hold");
  });

  it("rejects bad goal input", async () => {
    const { app, repo } = setup();
    expect((await call(app, "PUT", "/api/goals/bogus", { mode: "hold", target: 25, stepMin: 2 })).status).toBe(404);
    for (const body of [{ mode: "fast", target: 25, stepMin: 2 }, { mode: "hold", target: 0, stepMin: 2 }, { mode: "hold", target: 25.5, stepMin: 2 }, { mode: "hold", target: 25, stepMin: -1 }, { mode: "hold" }]) {
      expect((await call(app, "PUT", "/api/goals/vo2", body)).status).toBe(400);
    }
    expect(await repo.goalChanges()).toHaveLength(0);
    expect(repo.decisionLog).toHaveLength(0);
  });

  it("saves lift counts and rejects out-of-range ones", async () => {
    const { app } = setup();
    const res = await call(app, "PUT", "/api/lifts", { upper: 2, lower: 0 });
    expect(res.status).toBe(200);
    expect((await res.json()).lifts).toEqual({ upper: 2, lower: 0 });
    expect((await call(app, "PUT", "/api/lifts", { upper: 8, lower: 0 })).status).toBe(400);
    expect((await call(app, "PUT", "/api/lifts", { upper: 1 })).status).toBe(400);
  });
});

describe("a skipped session", () => {
  /** Monday's upper lift was skipped: its instance is cancelled on the calendar. */
  const skipLiftB = (events: CalendarEvent[]) => {
    events.find((e) => e.id === "lift-b-1109")!.status = "cancelled";
  };

  it("can be moved to a later day, which brings it back on the calendar", async () => {
    const { app, patches, events, repo } = setup();
    skipLiftB(events);
    const week = await (await call(app, "GET", "/api/week?start=2026-11-09")).json();
    expect(week.days[0].sessions[0]).toMatchObject({ id: "lift-b-1109", status: "skipped" });

    const opts = await options(app, "lift-b-1109", "move");
    const wed = opts.options.find((o: { id: string }) => o.id === "move:2026-11-11");
    expect(wed).toBeDefined();

    const res = await call(app, "POST", "/api/sessions/lift-b-1109/apply", { action: "move", optionId: wed.id, planVersion: opts.planVersion });
    expect(res.status).toBe(200);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: "lift-b-1109", patch: { date: "2026-11-11", status: "confirmed" } });
    expect(repo.decisionLog.at(-1)).toMatchObject({ trigger: "apply_move", status: "applied" });

    const out = await res.json();
    const day = out.week.days[2];
    expect(day.date).toBe("2026-11-11");
    expect(day.sessions[0]).toMatchObject({ id: "lift-b-1109", status: "planned" });
  });

  it("stays skipped when the calendar write fails", async () => {
    const { app, events } = setup({ failOn: (id) => id === "lift-b-1109" });
    skipLiftB(events);
    const opts = await options(app, "lift-b-1109", "move");
    const res = await call(app, "POST", "/api/sessions/lift-b-1109/apply", { action: "move", optionId: "move:2026-11-11", planVersion: opts.planVersion });
    expect(res.status).toBe(502);
    expect(events.find((e) => e.id === "lift-b-1109")!.status).toBe("cancelled");
  });

  it("can be marked done on its own day, and the status updates", async () => {
    const { app, repo, events } = setup();
    skipLiftB(events);
    const res = await call(app, "POST", "/api/sessions/lift-b-1109/done");
    expect(res.status).toBe(200);
    expect((await res.json()).home.strength.upper.actual).toBe(1);
    const week = await (await call(app, "GET", "/api/week?start=2026-11-09")).json();
    expect(week.days[0].sessions[0]).toMatchObject({ id: "lift-b-1109", status: "done", doneSource: "manual" });
    expect(repo.decisionLog.map((d) => d.trigger)).toEqual(["mark_done"]);
  });

  it("refuses to mark done the stand-in a moved session leaves behind", async () => {
    const { app, events } = setup();
    const e = events.find((x) => x.id === "lift-b-1109")!;
    e.originalStartTime = { date: "2026-11-09" };
    e.start = { date: "2026-11-17" }; // moved to next week
    const res = await call(app, "POST", "/api/sessions/lift-b-1109~origin/done");
    expect(res.status).toBe(422);
  });
});

describe("apply: move into next week", () => {
  it("moves the session, cancels the one it replaces, and the origin week records a miss", async () => {
    const { app, repo, patches } = setup();
    const opts = await options(app, "end-1114", "move");
    const sat = opts.options.find((o: { id: string }) => o.id === "move:2026-11-21");
    expect(sat.absorbs).toEqual([{ sessionId: "end-1121" }]);

    const res = await call(app, "POST", "/api/sessions/end-1114/apply", { action: "move", optionId: sat.id, planVersion: opts.planVersion });
    expect(res.status).toBe(200);
    expect(patches.map((p) => [p.id, p.patch.date ?? p.patch.status])).toEqual([
      ["end-1114", "2026-11-21"],
      ["end-1121", "cancelled"], // the replaced one goes last
    ]);
    const week = (await res.json()).week;
    expect(week.days[5].sessions[0]).toMatchObject({ status: "skipped", movedTo: "2026-11-21" });
    expect(repo.decisionLog.at(-1)).toMatchObject({ trigger: "apply_move", status: "applied" });

    const next = await (await call(app, "GET", "/api/week?start=2026-11-16")).json();
    const long = next.days[5].sessions;
    expect(long).toHaveLength(1);
    expect(long[0]).toMatchObject({ id: "end-1114", movedFrom: "2026-11-14" });
  });

  it("reverts the move when the cancel of the replaced session fails", async () => {
    const { app, events } = setup({ failOn: (id, patch) => id === "end-1121" && patch.status === "cancelled" });
    const opts = await options(app, "end-1114", "move");
    const sat = opts.options.find((o: { id: string }) => o.id === "move:2026-11-21");
    const res = await call(app, "POST", "/api/sessions/end-1114/apply", { action: "move", optionId: sat.id, planVersion: opts.planVersion });
    expect(res.status).toBe(502);
    expect(events.find((e) => e.id === "end-1114")!.start.date).toBe("2026-11-14");
  });
});
