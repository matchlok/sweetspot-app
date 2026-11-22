import { describe, expect, it } from "vitest";
import { memoryRepo } from "../src/repo";

const base = { purpose: "general fitness", raceDate: null, blockWeeks: 8, availability: { hoursPerWeek: 3.5 }, card: { goals: [] } };

describe("programs and planned sessions (memory repo)", () => {
  it("creates a program with sessions that start planned and unwritten", async () => {
    const repo = memoryRepo();
    const { program, sessions } = await repo.createProgram(base, [
      { date: "2026-11-23", kind: "vo2", minutes: 60, title: "VO2" },
      { date: "2026-11-25", kind: "lift", minutes: 40 },
    ]);
    expect(program).toMatchObject({ id: 1, status: "active", blockWeeks: 8 });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ programId: 1, status: "planned", calendarEventId: null });
    expect(sessions[1]!.title).toBeNull();
  });

  it("lists an inclusive date range, ordered by date", async () => {
    const repo = memoryRepo();
    await repo.createProgram(base, [
      { date: "2026-11-29", kind: "endurance", minutes: 90 },
      { date: "2026-11-23", kind: "vo2", minutes: 60 },
      { date: "2026-12-06", kind: "endurance", minutes: 90 },
    ]);
    const week = await repo.plannedSessions("2026-11-23", "2026-11-29");
    expect(week.map((s) => s.date)).toEqual(["2026-11-23", "2026-11-29"]);
    expect(await repo.plannedSessions("2027-01-01", "2027-01-07")).toEqual([]);
  });

  it("updates a session (move, event id, status) and returns null for an unknown id", async () => {
    const repo = memoryRepo();
    const { sessions } = await repo.createProgram(base, [{ date: "2026-11-23", kind: "vo2", minutes: 60 }]);
    const id = sessions[0]!.id;
    const moved = await repo.updatePlannedSession(id, { date: "2026-11-24", calendarEventId: "evt1" });
    expect(moved).toMatchObject({ date: "2026-11-24", calendarEventId: "evt1", minutes: 60 });
    expect((await repo.updatePlannedSession(id, { status: "skipped" }))!.status).toBe("skipped");
    expect(await repo.plannedSessions("2026-11-23", "2026-11-23")).toEqual([]);
    expect(await repo.updatePlannedSession(99, { minutes: 1 })).toBeNull();
  });

  it("deletes one session and reports whether it existed", async () => {
    const repo = memoryRepo();
    const { sessions } = await repo.createProgram(base, [{ date: "2026-11-23", kind: "vo2", minutes: 60 }]);
    expect(await repo.deletePlannedSession(sessions[0]!.id)).toBe(true);
    expect(await repo.deletePlannedSession(sessions[0]!.id)).toBe(false);
    expect(await repo.plannedSessions("2026-11-23", "2026-11-23")).toEqual([]);
  });
});
