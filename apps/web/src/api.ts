import type { DayOptionsView, GoalDraft, GoalKey, GoalPreviewPoint, GoalView, HomeView, MonthView, ProgramView, WeekView } from "@sweetspot/engine";
import goalFixture from "../../../packages/engine/test/fixtures/goal-sweetSpot.json";
import homeFixture from "../../../packages/engine/test/fixtures/home.json";
import programFixture from "../../../packages/engine/test/fixtures/program.json";
import optsUpper from "../../../packages/engine/test/fixtures/options-move-upper.json";
import optsVo2 from "../../../packages/engine/test/fixtures/options-move-vo2.json";
import weekFixture from "../../../packages/engine/test/fixtures/week.json";

export const fixtureMode = new URLSearchParams(location.search).has("fixture");

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;

/**
 * One place that turns every failure into an ApiError with a sentence to show:
 * no network, a timeout, and a 200 that isn't JSON (a dev server answering an
 * /api call with its HTML page, which used to leave screens on "Loading…").
 */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", signal: ctl.signal, ...init });
  } catch (e) {
    throw new ApiError(0, ctl.signal.aborted ? "timeout" : "offline", ctl.signal.aborted ? "The server took too long to answer." : "Can't reach the server. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(res.status, e?.code ?? "unknown", e?.message ?? `Request failed (${res.status})`);
  }
  if (body === null || typeof body !== "object") throw new ApiError(res.status, "bad_response", "The server sent something the app can't read.");
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  me: () => (fixtureMode ? Promise.resolve({ user: "narjit" }) : request<{ user: string }>("/api/auth/me")),
  login: (passphrase: string) =>
    request<void>("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  home: () => (fixtureMode ? Promise.resolve(homeFixture as unknown as HomeView) : request<HomeView>("/api/home")),
  week: (start?: string) =>
    fixtureMode ? Promise.resolve(weekFixture as unknown as WeekView) : request<WeekView>(`/api/week${start ? `?start=${start}` : ""}`),
  month: (date?: string) => request<MonthView>(`/api/month${date ? `?date=${date}` : ""}`),
  /** Pull to refresh: fetch new activities from intervals.icu now. */
  sync: () => (fixtureMode ? Promise.resolve(undefined) : request<{ lastSyncedAt: string; newActivities: number }>("/api/sync", { method: "POST" })),
  options: (id: string, action: "move" | "swap" | "skip") => {
    if (fixtureMode) {
      const f = (id === "w2-upper" ? optsUpper : optsVo2) as unknown as DayOptionsView;
      return Promise.resolve(action === "move" ? f : { ...f, action, options: [], blocked: [] });
    }
    return request<DayOptionsView>(`/api/sessions/${enc(id)}/options?action=${action}`);
  },
  apply: (id: string, body: { action: string; optionId: string; planVersion: string }) =>
    fixtureMode
      ? Promise.resolve(undefined)
      : request<unknown>(`/api/sessions/${enc(id)}/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  markDone: (id: string) =>
    fixtureMode ? Promise.resolve(undefined) : request<unknown>(`/api/sessions/${enc(id)}/done`, { method: "POST" }),
  program: () =>
    fixtureMode ? Promise.resolve(programFixture as unknown as ProgramView) : request<ProgramView>("/api/program"),
  goal: (key: GoalKey) => {
    if (!fixtureMode) return request<GoalView>(`/api/goals/${key}`);
    const p = (programFixture as unknown as ProgramView).goals.find((g) => g.key === key)!;
    return Promise.resolve({ ...(goalFixture as unknown as GoalView), key, label: p.label, mode: p.mode, target: p.target, stepMin: p.stepMin });
  },
  goalPreview: (key: GoalKey, d: GoalDraft) =>
    fixtureMode
      ? Promise.resolve({ preview: (goalFixture as unknown as GoalView).preview })
      : request<{ preview: GoalPreviewPoint[] }>(`/api/goals/${key}/preview?mode=${d.mode}&target=${d.target}&stepMin=${d.stepMin}`),
  saveGoal: (key: GoalKey, d: GoalDraft) =>
    fixtureMode
      ? Promise.resolve(undefined)
      : request<GoalView>(`/api/goals/${key}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(d),
        }),
  saveLifts: (lifts: { upper: number; lower: number }) =>
    fixtureMode
      ? Promise.resolve(undefined)
      : request<ProgramView>("/api/lifts", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(lifts),
        }),
};
