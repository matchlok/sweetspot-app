import { describe, expect, it } from "vitest";
import { homeView, sessionOptionsView, weekView } from "../src/views";
import { v4Scenario as D } from "./fixtures/scenario";

/** SWE-43: a skip only means "not done yet". It becomes a miss when the week ends. */
const skip = (data: typeof D, ids: string[]) => ({
  ...data,
  plans: data.plans.map((p) => ({ ...p, sessions: p.sessions.map((s) => (ids.includes(s.id) ? { ...s, status: "skipped" as const } : s)) })),
});
const find = (data: typeof D, id: string) => weekView(data, "2026-11-09").days.flatMap((d) => d.sessions).find((s) => s.id === id)!;

describe("a skipped session mid-week (today Tue Nov 10)", () => {
  const data = skip(D, ["w2-long"]);

  it("reads Not done, for a day ahead and for a day already past", () => {
    expect(find(data, "w2-long")).toMatchObject({ status: "skipped", statusLabel: "Not done" });
    const past = { ...data, today: "2026-11-12", now: new Date("2026-11-12T18:00:00Z") };
    expect(find(skip(past, ["w2-vo2"]), "w2-vo2")).toMatchObject({ status: "not_logged", statusLabel: "Not done" });
  });

  it("moves like a planned session, with the same days and the miss warning", () => {
    const planned = sessionOptionsView(D, "w2-long", "move");
    const skipped = sessionOptionsView(data, "w2-long", "move");
    expect(skipped.options.map((o) => o.id)).toEqual(planned.options.map((o) => o.id));
    expect(skipped.options.map((o) => o.effects)).toEqual(planned.options.map((o) => o.effects));
    expect(skipped.blocked).toEqual(planned.blocked);
  });

  it("does not change goal bars or the week's judgment until the week is over", () => {
    expect(homeView(data).goals).toEqual(homeView(D).goals);
  });

  it("un-skips by moving: the moved session is planned again", () => {
    const o = sessionOptionsView(data, "w2-long", "move");
    expect(o.options.length).toBeGreaterThan(0);
    expect(o.blocked.some((b) => /skipped/i.test(b.reason))).toBe(false);
  });
});

describe("the same skipped session once the week is over (today Tue Nov 17)", () => {
  const late = { ...skip(D, ["w2-long"]), today: "2026-11-17", now: new Date("2026-11-17T14:30:00Z") };

  it("reads Missed and counts like a not-logged session", () => {
    expect(find(late, "w2-long")).toMatchObject({ status: "not_logged", statusLabel: "Missed" });
    expect(find({ ...D, today: "2026-11-17", now: late.now }, "w2-long")).toMatchObject({ status: "not_logged", statusLabel: "Missed" });
  });

  it("stays locked to this week: only days of next week, with no extra miss line", () => {
    const o = sessionOptionsView(late, "w2-long", "move");
    expect(o.options.length).toBeGreaterThan(0);
    expect(o.options.every((x) => x.id >= "move:2026-11-16" && x.heading.endsWith("next week"))).toBe(true);
    expect(o.options.every((x) => !x.effects.some((e) => /counts as missed/.test(e.text)))).toBe(true);
  });
});
