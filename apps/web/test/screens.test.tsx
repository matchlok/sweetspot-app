import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DayOptionsView, HomeView, MonthView, WeekView } from "@sweetspot/engine";
import homeFixture from "../../../packages/engine/test/fixtures/home.json";
import weekFixture from "../../../packages/engine/test/fixtures/week.json";
import optsVo2 from "../../../packages/engine/test/fixtures/options-move-vo2.json";

// jsdom has no PointerEvent; this one carries clientY and pointerId like a browser's.
if (!("PointerEvent" in window)) {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventShim;
}

vi.mock("../src/api", () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  }
  return {
    ApiError,
    fixtureMode: false,
    api: { tagLift: vi.fn(), home: vi.fn(), week: vi.fn(), month: vi.fn(), sync: vi.fn(), options: vi.fn(), apply: vi.fn(), markDone: vi.fn(), program: vi.fn() },
  };
});

import { api } from "../src/api";
import { Calendar } from "../src/screens/Calendar";
import { DaySheet } from "../src/screens/DaySheet";
import { Home } from "../src/screens/Home";
import { Shell } from "../src/Shell";

const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const home = homeFixture as unknown as HomeView;
const week = weekFixture as unknown as WeekView;

beforeEach(() => {
  m.home!.mockResolvedValue(home);
  m.week!.mockResolvedValue(week);
  m.options!.mockResolvedValue(optsVo2 as unknown as DayOptionsView);
  m.program!.mockResolvedValue({ goals: [], lifts: { upper: 1, lower: 1 }, recovery: { streak: 0, after: 3, factor: 0.6, text: "" } });
  m.sync!.mockResolvedValue({ lastSyncedAt: "x", newActivities: 0 });
});
afterEach(cleanup);

describe("Home", () => {
  it("shows an error with a retry instead of loading forever", async () => {
    m.home!.mockRejectedValueOnce(new Error("Can't reach the server. Check your connection."));
    render(<Home onOpen={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Can't reach the server");
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("Tuesday")).toBeTruthy();
    expect(m.home).toHaveBeenCalledTimes(2);
  });

  it("opens the readiness inputs on tap", async () => {
    render(<Home onOpen={() => {}} />);
    const pill = await screen.findByRole("button", { name: /Ready/ });
    expect(screen.queryByText("Recent hard days")).toBeNull();
    fireEvent.click(pill);
    expect(screen.getByText("Recent hard days")).toBeTruthy();
    expect(screen.getByText(/provisional/)).toBeTruthy();
    fireEvent.click(pill);
    expect(screen.queryByText("Recent hard days")).toBeNull();
  });
});

describe("Strength bar", () => {
  const withLift = {
    ...home,
    strength: {
      label: "Strength", actual: 1, target: 2, hit: false,
      upper: { actual: 0, target: 1 }, lower: { actual: 0, target: 1 },
      lifts: [{ id: "strava:1", date: "2026-11-10", tag: null, tagSource: null }], untagged: 1,
    },
  } as unknown as HomeView;

  it("shows the total, the upper and lower counts, and asks for a tag", async () => {
    m.home!.mockResolvedValue(withLift);
    render(<Home onOpen={() => {}} />);
    expect(await screen.findByText("Strength")).toBeTruthy();
    expect(screen.getByText(/Upper 0\/1 · Lower 0\/1 · 1 to tag/)).toBeTruthy();
    expect(screen.getByText(/tag it/)).toBeTruthy();
  });

  it("tapping Upper tags the lift and reloads", async () => {
    m.home!.mockResolvedValue(withLift);
    m.tagLift!.mockResolvedValue(undefined);
    render(<Home onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Upper" }));
    await waitFor(() => expect(m.tagLift).toHaveBeenCalledWith("strava:1", "upper"));
    await waitFor(() => expect(m.home).toHaveBeenCalledTimes(2));
  });
});

describe("Calendar", () => {
  it("steps to the next week and back to today", async () => {
    render(<Calendar onOpen={() => {}} />);
    await screen.findByText("Nov 9 to 15");
    fireEvent.click(screen.getByLabelText("Next week"));
    await waitFor(() => expect(m.week).toHaveBeenLastCalledWith("2026-11-16"));
    fireEvent.click(await screen.findByText("Today"));
    await waitFor(() => expect(m.week).toHaveBeenLastCalledWith(undefined));
  });

  it("switches to the month grid and opens a tapped day's week", async () => {
    const month = {
      month: "2026-11",
      label: "November 2026",
      start: "2026-11-09",
      weeks: [{ start: "2026-11-09", days: week.days.map((d) => ({ ...d, inMonth: true, sessions: d.sessions.map((s) => ({ id: s.id, kind: s.kind, status: s.status, title: s.title })) })) }],
    } as unknown as MonthView;
    m.month!.mockResolvedValue(month);
    render(<Calendar onOpen={() => {}} />);
    await screen.findByText("Nov 9 to 15");
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(await screen.findByText("November 2026")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Tue, Nov 10/ })[0]!);
    await waitFor(() => expect(m.week).toHaveBeenLastCalledWith("2026-11-09"));
    expect(await screen.findByText("Nov 9 to 15")).toBeTruthy();
  });
});

describe("DaySheet", () => {
  const handle = () => screen.getByTestId("sheet-handle");

  it("closes when the handle is dragged far enough", async () => {
    const onClose = vi.fn();
    render(<DaySheet sessionId="w2-vo2" onClose={onClose} onChanged={() => {}} />);
    await screen.findByText("Where should it go?");
    fireEvent.pointerDown(handle(), { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 220, pointerId: 1 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("snaps back on a short drag, and Escape closes", async () => {
    const onClose = vi.fn();
    render(<DaySheet sessionId="w2-vo2" onClose={onClose} onChanged={() => {}} />);
    await screen.findByText("Where should it go?");
    fireEvent.pointerDown(handle(), { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 140, pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("pull to refresh", () => {
  const pull = (el: Element, from: number, to: number) => {
    fireEvent.touchStart(el, { touches: [{ clientY: from }] });
    fireEvent.touchMove(el, { touches: [{ clientY: to }] });
    fireEvent.touchEnd(el);
  };

  it("fetches new rides and reloads when pulled past the trigger", async () => {
    render(<Shell onLogout={() => {}} />);
    const body = (await screen.findByText("Tuesday")).closest("main")!;
    pull(body, 0, 160);
    await waitFor(() => expect(m.sync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(m.home).toHaveBeenCalledTimes(2));
  });

  it("ignores a short pull", async () => {
    render(<Shell onLogout={() => {}} />);
    const body = (await screen.findByText("Tuesday")).closest("main")!;
    pull(body, 0, 40);
    expect(m.sync).not.toHaveBeenCalled();
  });

  it("says so when the refresh fails", async () => {
    m.sync!.mockRejectedValueOnce(new Error("intervals.icu is down."));
    render(<Shell onLogout={() => {}} />);
    const body = (await screen.findByText("Tuesday")).closest("main")!;
    pull(body, 0, 160);
    expect(await screen.findByText("intervals.icu is down.")).toBeTruthy();
  });
});
