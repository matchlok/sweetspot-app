import type { SessionKind, SessionStatus } from "@sweetspot/engine";

/** Dot color for a planned session, by type. */
export const KIND_DOT: Record<SessionKind, string> = {
  endurance: "#7c8cf8",
  sweet_spot: "#e0b25c",
  threshold: "#e0b25c",
  vo2: "#ee7480",
  easy_spin: "#7c8cf8",
  lift_upper: "#c4c6d2",
  lift_lower: "#c4c6d2",
};

export const DONE_DOT = "#8fe0bd";
export const NOT_LOGGED_DOT = "#e8bd62";
export const SKIPPED_DOT = "#8d90a0";

/**
 * The one place a session's status becomes a dot color, shared by the week list and the month grid.
 * Done is green, not logged is yellow, skipped is gray, and a planned session keeps its type's color.
 */
export function statusDotColor(status: SessionStatus, kind: SessionKind): string {
  switch (status) {
    case "done":
      return DONE_DOT;
    case "not_logged":
      return NOT_LOGGED_DOT;
    case "skipped":
      return SKIPPED_DOT;
    default:
      return KIND_DOT[kind];
  }
}
