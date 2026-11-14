import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { eventDate, kindFromTitle, minutesFromTitle, readWeek, type CalendarEvent } from "../src/calendar";

const ev = (id: string, summary: string, date: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  summary,
  start: { date },
  ...extra,
});

describe("kindFromTitle", () => {
  it.each([
    ["Lift B — Upper Body + Core (30 min)", "lift_upper"],
    ["Lift A — Lower Body + Core (30 min)", "lift_lower"],
    ["VO2 Max Intervals — Trail (~1 hr)", "vo2"],
    ["Endurance Ride — Z2/3 (1.5 hrs)", "endurance"],
    ["Endurance Ride — Recovery Week (1 hr)", "endurance"],
    ["Easy Spin — Recovery Week (optional)", "easy_spin"],
    ["Sweet Spot Ride — 3-4x5 min (~50 min)", "sweet_spot"],
  ])("%s -> %s", (title, kind) => expect(kindFromTitle(title)).toBe(kind));

  it("returns null instead of guessing", () => {
    expect(kindFromTitle("Dentist")).toBeNull();
    expect(kindFromTitle("Lift")).toBeNull();
  });
});

describe("minutesFromTitle", () => {
  it.each([
    ["Lift A — Lower Body + Core (30 min)", 30],
    ["VO2 Max Intervals — Trail (~1 hr)", 60],
    ["Endurance Ride — Z2/3 (1.5 hrs)", 90],
    ["Sweet Spot Ride — 3-4x5 min (~50 min)", 50],
  ])("%s -> %s", (title, min) => expect(minutesFromTitle(title)).toBe(min));

  it("is null when there's no duration", () => {
    expect(minutesFromTitle("Easy Spin — Recovery Week (optional)")).toBeNull();
  });
});

describe("eventDate", () => {
  it("uses all-day dates as written", () => {
    expect(eventDate({ id: "a", start: { date: "2026-11-10" } })).toBe("2026-11-10");
  });
  it("places timed events by Denver date, not UTC", () => {
    // 03:00 UTC on Nov 11 is 8 pm MST on Nov 10.
    expect(eventDate({ id: "a", start: { dateTime: "2026-11-11T03:00:00Z" } })).toBe("2026-11-10");
  });
});

describe("readWeek", () => {
  const events: CalendarEvent[] = [
    ev("e2", "VO2 Max Intervals — Trail (~1 hr)", "2026-11-10"),
    ev("e1", "Lift B — Upper Body + Core (30 min)", "2026-11-09"),
    ev("out", "Endurance Ride — Z2/3 (1.5 hrs)", "2026-11-16"), // next week
    ev("tagged", "Morning ride", "2026-11-12", { extendedProperties: { private: { sweetspotKind: "sweet_spot" } } }),
    ev("skip", "Endurance Ride — Z2/3 (1.5 hrs)", "2026-11-14", { status: "cancelled" }),
    ev("mystery", "Dentist", "2026-11-11"),
  ];
  const plan = readWeek(events, "2026-11-09");

  it("keeps only the week, in date order", () => {
    expect(plan.sessions.map((s) => s.id)).toEqual(["e1", "e2", "tagged", "skip"]);
  });
  it("prefers the tag over the title", () => {
    const s = plan.sessions.find((x) => x.id === "tagged")!;
    expect(s.kind).toBe("sweet_spot");
    expect(s.kindSource).toBe("tag");
  });
  it("marks cancelled instances as skipped", () => {
    expect(plan.sessions.find((x) => x.id === "skip")!.status).toBe("skipped");
  });
  it("reports unrecognized events and does not guess", () => {
    expect(plan.unrecognized).toEqual([{ id: "mystery", date: "2026-11-11", title: "Dentist" }]);
  });
});

// Local-only: every planned session in the Muse export parses to the kind Muse stored.
const exportPath = new URL("../../../data/private/week-plans-export.json", import.meta.url);
describe.skipIf(!existsSync(exportPath))("Muse export", () => {
  it("title parser matches the stored kinds", () => {
    const { weeks } = JSON.parse(readFileSync(exportPath, "utf8")) as {
      weeks: { sessions: { title: string; kind: string }[] }[];
    };
    const all = weeks.flatMap((w) => w.sessions);
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect(kindFromTitle(s.title), s.title).toBe(s.kind);
  });
});
