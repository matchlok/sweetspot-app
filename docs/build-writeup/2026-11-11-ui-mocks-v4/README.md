# UI mocks v4 (2026-11-10, reviewed 2026-11-11)

The fourth round of screens, following [v3](../2026-11-07-ui-mocks-v3/README.md). The canvas is https://claude.ai/artifact/C2uoK4woKEtkUq3xd3qMdJ (private). All numbers are sample data except the targets (90 / 20 / 8 min).

- `canvas-v4.png` shows the six screens, rendered locally from `source/`.
- `source/` holds the canvas artboard files (`*.dc.html`, `canvas.json`) as published on 2026-11-11.

## What v4 changes from v3

- **Navigation is Home · Calendar · Programming.** The center "Change the plan" button is gone. Plan changes start from a day: tap a session on the Calendar, or tap the Today card on Home.
- **Home** shows a readiness pill, today's session, the week's goal bars (zone minutes and lifts), and a fatigue strip (Form, ramp, load).
- **Day sheet** replaces the v3 Replan screen for single-session changes. Today and future sessions get Move, Swap and Skip, and each option states its knock-on effects before you confirm. A missed session in the current week gets "move it to a day that's left".
- **Programming** holds the "What changed?" chips, the four zone goals, the lift counts (0 to 7 a week each) and the recovery-week streak.
- **Goal settings** edits one goal: Progress, Hold or Off, the target, the step, and a preview of where the target goes.

## The scenario the six screens share

It is Tuesday, Nov 10, week 2 of the program. Week 1 was a hit week, so sweet spot is at 22 min for its next planned week (Nov 17). Monday's upper lift wasn't logged. Today is VO2 with an 8 min target. Thursday is the lower lift and Saturday is the endurance ride.

## Review pass, 2026-11-11

The screens were rendered and checked against each other. Fixed:

- **One story across screens.** Home showed Monday's lift as done while the missed-day sheet showed it as missed, and Home had 40 endurance minutes with no ride in the calendar. Every screen now uses the scenario above.
- **Home leads somewhere.** The Today card opens the day sheet. The upper-lift row carries a line that opens the missed-day sheet ("Still open from Monday. Wed or Fri fits.").
- **Swap and Skip exist.** Only Move was drawn. The day sheet now switches between the three, the options are selectable, and the button names what it will do ("Move to Friday, lift to Wednesday").
- **"Mark it done"** on the missed-day sheet, for a lift done without a recording.
- **Goal settings is live.** The mode switch and steppers work and the preview redraws. The preview lists the weeks sweet spot is planned (every other Tuesday), where the old chart assumed every week.
- **Targets agree.** Sweet spot reads 22 min on Home, Calendar, Programming and Goal settings. Before, it read 20 in some places and 22 in others.
- **Clipping and wrapping.** The recovery card on Programming was cut off by the tab bar. The sweet-spot line and the fatigue labels on Home wrapped badly.
- **Copy error.** The Sunday option said "two days after endurance". Sunday is the day after Saturday's ride.
- **Lifts have their own color** (neutral grey). They shared the endurance blue, which is also the selection color.
- **Touch targets.** Steppers and chips are 44 px tall, and controls are real buttons.

## Assumptions made in the review, to confirm

1. **Skip counts as a miss.** The goal stays unmet, the target repeats, and the streak toward a recovery week restarts.
2. **Goal edits apply from the current week on.** Past weeks keep the targets they were judged against.
3. **Lifts don't affect the hit streak.** Only progress goals do, as in the engine today.
4. **Moves stay inside the current week.**

## Not mocked yet

- Day sheet for a past day that was done (what you rode and how it scored).
- Day sheet for an open day.
- Home on an open day, after today's session is done, and in a recovery week.
- Month view in the v4 style (v3 has one).
- The result of a "What changed?" chip (v3's Replan screen is the reference).
- Loading, offline and "last synced" states.
- What the readiness pill shows when tapped.

In the prototype, only Monday and Tuesday open a day sheet, and only Sweet spot opens Goal settings.
