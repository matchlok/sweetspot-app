import { readWeek, type CalendarEvent } from "../../src/calendar";
import { DEFAULT_PROGRAM } from "../../src/targets";
import type { RideZones } from "../../src/intervals";
import type { ViewData } from "../../src/views";

/**
 * The v4 scenario (docs/build-writeup/2026-11-11-ui-mocks-v4/README.md):
 * Tuesday Nov 10 2026, 7:30 am Denver, week 2 of the program. Week 1 was a hit
 * week. Monday's upper lift wasn't logged. Today is VO2. Thursday is the lower
 * lift and Saturday the endurance ride. Under the 2026-11-20 rules every week
 * carries endurance, sweet spot and VO2 (no alternation), so week 1's hit also
 * stepped VO2 up to 9 min and sweet spot to 21 min for week 2. Week 2's sweet
 * spot sits on Sunday, so no hard rule trips on the base plan.
 */
const ev = (id: string, date: string, summary: string): CalendarEvent => ({ id, summary, status: "confirmed", start: { date } });

const events: CalendarEvent[] = [
  // Week 1 (Nov 2 to 8): sweet spot Tuesday, VO2 Thursday, endurance Saturday.
  ev("w1-ss", "2026-11-03", "Sweet Spot Intervals (~1 hr)"),
  ev("w1-vo2", "2026-11-05", "VO2 Max Intervals, trail (~1 hr)"),
  ev("w1-long", "2026-11-07", "Endurance Ride (1.5 hrs)"),
  // Week 2 (Nov 9 to 15): upper lift Monday, VO2 today, lower lift Thursday, endurance Saturday.
  ev("w2-upper", "2026-11-09", "Lift B — Upper Body + Core"),
  ev("w2-vo2", "2026-11-10", "VO2 Max Intervals, trail (~1 hr)"),
  ev("w2-lower", "2026-11-12", "Lift A — Lower Body + Core"),
  ev("w2-long", "2026-11-14", "Endurance Ride (1.5 hrs)"),
  ev("w2-ss", "2026-11-15", "Sweet Spot Intervals (~1 hr)"),
  // Week 3 (Nov 16 to 22): sweet spot Tuesday, VO2 Thursday.
  ev("w3-upper", "2026-11-16", "Lift B — Upper Body + Core"),
  ev("w3-ss", "2026-11-17", "Sweet Spot Intervals (~1 hr)"),
  ev("w3-vo2", "2026-11-19", "VO2 Max Intervals, trail (~1 hr)"),
  ev("w3-long", "2026-11-21", "Endurance Ride (1.5 hrs)"),
];

const ride = (id: string, date: string, power: number[], ss: number): RideZones => ({
  id,
  date,
  movingSeconds: power.reduce((a, b) => a + b, 0),
  category: "unknown",
  categorySource: null,
  power,
  sweetSpotSeconds: ss,
});

export const v4Scenario: ViewData = {
  today: "2026-11-10",
  now: new Date("2026-11-10T14:30:00Z"), // 7:30 am MST
  program: DEFAULT_PROGRAM,
  plans: [readWeek(events, "2026-11-02"), readWeek(events, "2026-11-09"), readWeek(events, "2026-11-16")],
  rides: [
    // Sweet spot ride: 22 min at 88 to 94% FTP.
    ride("r1", "2026-11-03", [300, 600, 1500, 1320, 0, 0, 0], 1320),
    // Saturday long ride: 95 min in Z2 and Z3.
    ride("r2", "2026-11-07", [300, 4200, 1500, 0, 0, 0, 0], 0),
    // VO2 ride: 9 min in Z5.
    ride("r0", "2026-11-05", [300, 1200, 0, 0, 540, 0, 0], 0),
  ],
  lifts: [],
  wellness: [{ id: "2026-11-10", ctl: 42, atl: 47, rampRate: 3.2 }],
  lastSyncedAt: "2026-11-10T06:02:00-07:00",
};
