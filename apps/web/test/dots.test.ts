import { describe, expect, it } from "vitest";
import { DONE_DOT, KIND_DOT, NOT_LOGGED_DOT, SKIPPED_DOT, statusDotColor } from "../src/screens/dots";

describe("statusDotColor", () => {
  it("done is green, not logged yellow, skipped gray, whatever the type", () => {
    expect(statusDotColor("done", "lift_upper")).toBe(DONE_DOT);
    expect(statusDotColor("done", "vo2")).toBe(DONE_DOT);
    expect(statusDotColor("not_logged", "endurance")).toBe(NOT_LOGGED_DOT);
    expect(statusDotColor("skipped", "sweet_spot")).toBe(SKIPPED_DOT);
  });

  it("planned keeps the color for its session type", () => {
    expect(statusDotColor("planned", "vo2")).toBe(KIND_DOT.vo2);
    expect(statusDotColor("planned", "endurance")).toBe(KIND_DOT.endurance);
    expect(statusDotColor("planned", "lift_lower")).toBe(KIND_DOT.lift_lower);
  });

  it("the three status colors differ from each other", () => {
    expect(new Set([DONE_DOT, NOT_LOGGED_DOT, SKIPPED_DOT]).size).toBe(3);
  });
});
