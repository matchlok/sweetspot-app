import { createHash } from "node:crypto";
import {
  GOAL_KEYS,
  addDays,
  forecastProgram,
  generateProgram,
  mapLifts,
  mondayOf,
  programStateAt,
  programView,
  recentRates,
  type GoalForecast,
  type ProgramAvailability,
  type ProgramCard,
  type ProgramHistory,
  type ProgramPurpose,
  type SessionKind,
} from "@sweetspot/engine";
import { PROGRAM_TAG } from "./calendarWriter";
import { loadViewData, type DataDeps } from "./data";
import { DEFAULT_ROUTING, selectActivities } from "./routing";

/** Pure-ish builders behind POST /api/program/draft and /commit. Nothing here writes. */

export const MAX_DAY_MINUTES = 300;
/** Strength sessions a week are counted over this many full weeks before the current one. */
export const HISTORY_WEEKS = 8;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ["race", "faster", "comeback", "hold"] as const;

/** A request the server refuses. `blocked` is a rule or a not-yet-built purpose, `invalid` is a malformed body. */
export class DraftError extends Error {
  constructor(
    readonly status: 400 | 422,
    readonly code: "invalid" | "blocked",
    message: string,
  ) {
    super(message);
  }
}

export interface DraftInput {
  availability: ProgramAvailability;
  purpose: ProgramPurpose;
}

export function parseDraftInput(body: Record<string, unknown> | null): DraftInput {
  const minutes = (body?.availability as { minutes?: unknown } | undefined)?.minutes;
  if (!Array.isArray(minutes) || minutes.length !== 7 || !minutes.every((m) => typeof m === "number" && Number.isInteger(m) && m >= 0 && m <= MAX_DAY_MINUTES)) {
    throw new DraftError(400, "invalid", `availability.minutes needs 7 whole numbers from 0 to ${MAX_DAY_MINUTES}, Monday first.`);
  }
  const p = body?.purpose as { kind?: unknown; raceDate?: unknown } | undefined;
  if (typeof p?.kind !== "string" || !(KINDS as readonly string[]).includes(p.kind)) {
    throw new DraftError(400, "invalid", `purpose.kind must be one of ${KINDS.join(", ")}.`);
  }
  const kind = p.kind as ProgramPurpose["kind"];
  if (kind !== "race") return { availability: { minutes: [...(minutes as number[])] }, purpose: { kind } };
  if (typeof p.raceDate !== "string" || !DAY.test(p.raceDate) || Number.isNaN(Date.parse(`${p.raceDate}T12:00:00Z`))) {
    throw new DraftError(400, "invalid", "A race block needs purpose.raceDate as YYYY-MM-DD.");
  }
  return { availability: { minutes: [...(minutes as number[])] }, purpose: { kind, raceDate: p.raceDate } };
}

/** Strength sessions a week over the last 8 full weeks. "unknown" when none are stored: never a guess. */
export async function loadHistory(d: DataDeps, asOf: string): Promise<ProgramHistory> {
  const thisMonday = mondayOf(asOf);
  const rows = await d.repo.activities(addDays(thisMonday, -7 * HISTORY_WEEKS), addDays(thisMonday, -1));
  const lifts = mapLifts(selectActivities(rows, d.routing ?? DEFAULT_ROUTING).map((r) => r.raw));
  return { asOf, liftsPerWeek: lifts.length === 0 ? "unknown" : Math.round(lifts.length / HISTORY_WEEKS) };
}

export interface PreviewSession {
  kind: SessionKind;
  title: string;
  minutes: number;
}

export interface Draft {
  draftVersion: string;
  history: ProgramHistory;
  card: ProgramCard;
  preview: {
    weeks: { start: string; isRecovery: boolean; days: { date: string; sessions: PreviewSession[] }[] }[];
    strip: { start: string; isRecovery: boolean }[];
  };
  forecast: GoalForecast[];
  calendar: { from: string; to: string; clears: number; writes: number };
}

/** Stable across runs: the inputs are plain objects built in a fixed key order. */
export function draftVersionOf(blockStart: string, history: ProgramHistory, input: DraftInput, card: ProgramCard): string {
  const json = JSON.stringify([blockStart, history, input.availability, input.purpose, card]);
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

/**
 * The card, preview, forecast and calendar effect for a request. Reads Neon and the calendar, writes nothing.
 * "Keep progress" (2026-11-27): the card's modes stay, but each progress goal starts at the target in force now.
 */
export async function buildDraft(d: DataDeps, input: DraftInput, history: ProgramHistory): Promise<Draft> {
  const { purpose } = input;
  if (purpose.kind === "comeback" || purpose.kind === "hold") {
    throw new DraftError(422, "blocked", "Comeback and hold blocks aren't built yet.");
  }
  const blockStart = addDays(mondayOf(history.asOf), 7);
  if (purpose.kind === "race" && purpose.raceDate! < blockStart) {
    throw new DraftError(400, "invalid", `The race date is before the block starts on ${blockStart}.`);
  }

  let card: ProgramCard;
  try {
    card = generateProgram(history, input.availability, purpose);
  } catch (e) {
    throw new DraftError(422, "blocked", e instanceof Error ? e.message : "The generator could not build a program.");
  }

  const view = await loadViewData(d, history.asOf);
  const inForce = programView(view, history.asOf).goals;
  for (const key of GOAL_KEYS) {
    const g = card.program.goals[key];
    if (g.mode !== "progress") continue;
    card.program.goals[key] = { ...g, start: inForce.find((x) => x.key === key)!.target };
  }

  const forecast = forecastProgram(card, recentRates(programStateAt(view, history.asOf)));

  const firstTwo = card.weeks.slice(0, 2);
  const from = firstTwo[0]!.start;
  const to = addDays(firstTwo[firstTwo.length - 1]!.start, 6);
  const events = await d.sources.events(from, to);
  const clears = events.filter((e) => e.extendedProperties?.private?.[PROGRAM_TAG] !== undefined && e.status !== "cancelled").length;

  return {
    draftVersion: draftVersionOf(blockStart, history, input, card),
    history,
    card,
    preview: {
      weeks: firstTwo.map((w) => ({
        start: w.start,
        isRecovery: w.isRecovery,
        days: Array.from({ length: 7 }, (_, i) => {
          const date = addDays(w.start, i);
          return { date, sessions: w.sessions.filter((s) => s.date === date).map((s) => ({ kind: s.kind, title: s.title, minutes: s.minutes })) };
        }),
      })),
      strip: card.weeks.map((w) => ({ start: w.start, isRecovery: w.isRecovery })),
    },
    forecast,
    calendar: { from, to, clears, writes: firstTwo.reduce((n, w) => n + w.sessions.length, 0) },
  };
}
