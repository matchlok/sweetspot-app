# Next steps

Updated 2026-11-08, after the goal system and calendar connection. Keep "Next steps" in [AGENTS.md](../AGENTS.md) in sync with this list.

## Where we are

- Phase 0 is done: intervals.icu access works, Garmin syncs to it directly, and zones and FTP are set there.
- The UI direction is set in [build-writeup/2026-11-07-ui-mocks-v3](build-writeup/2026-11-07-ui-mocks-v3/README.md): a dark theme; a phone-only app; a 6:05 am push as the front door; and Home · [Change the plan] · Calendar.
- The stack is decided (2026-11-08): native SwiftUI plus a TypeScript engine. This replaces the Next.js/Recharts choice in [the technical plan](plans/TECHNICAL-PLAN.md).

## Next session (2026-11-08 update, pick up here)

State: goal system built and tested (`packages/engine/src/targets.ts`, 44 tests pass); Home shows goal bars with hit state; the Google Calendar "Training" calendar is readable and writable through the service account (verified: calendar id queried directly, tz America/Denver, access writer, 8 recurring all-day events in two weeks: Lift B Mon, Sweet Spot or VO2 Tue, Lift A Thu, Endurance Sat). Targets in `DEFAULT_PROGRAM` are placeholders (90 / 20 +2 / 8 +1; threshold off).

1. **Rule to confirm with Narjit:** judge a goal only in weeks where the plan has a session that serves it (e.g. VO2 only on VO2 weeks). Off weeks carry the target over and count as neither hit nor miss, so the 3-week recovery streak isn't broken.
2. **Calendar reader** in the engine: expand recurring series, map titles to session kinds (lift_upper "Lift B", lift_lower "Lift A", sweet_spot, vo2, endurance, easy_spin), check against the Muse export. Events are all-day, so the app places them in time itself.
3. **Strength goals:** 1 lower + 1 upper per week, done or missed only (no weights or reps). Read `WeightTraining` activities from intervals.icu (the adapter ignores them today); intervals.icu can't tell upper from lower, so match each lift to the planned lift on that day.
4. **Programming screen and calendar day sheet** (design first): edit goal modes, steps and starting targets; "What changed?" (cooked, short on time, extra time, free text). Day sheet: past = view only, except reshuffle the rest of the week for a missed day in the current week; today and future = Move, Swap, Skip with knock-on effects shown first. Shuffle rule: no heavy lower lift the day before a quality ride.
5. **Fatigue metrics:** show Form (CTL minus ATL), ramp rate and weekly load from intervals.icu wellness; ramp rate could trigger an early recovery week. HRV, resting HR and sleep are null (Garmin isn't sending them).
6. **Prediction:** predict whether Narjit will be performant (complete intervals at prescribed power) given the planned workouts, not whether he'll do them. Log and score every prediction.
7. Get real starting targets and step sizes from Narjit; define threshold's start.
8. Housekeeping: `apps/poc-web/README.md` still describes the old "normal band" scoring. Stop the POC server (port 5174) when done.

## Earlier next steps (mostly done)

1. **App stack: decided 2026-11-08.** Native SwiftUI plus a TypeScript engine on a server, phone only. See [decisions/0001-app-stack.md](decisions/0001-app-stack.md). Ask before creating the Apple Developer account.
2. **Engine scaffold: done 2026-11-08.** pnpm workspace, `packages/engine` (TypeScript strict, Vitest).
3. **Port: done except the golden check.** `categorize()`, `weeklyZoneRows()` and `zoneScorecard()` are ported with unit tests. The golden test against the 23 stored categories (`packages/engine/test/muse-golden.test.ts`) skips in the cloud because `data/private/` isn't there. **Run `pnpm test` on your Mac** to confirm it passes, and fix the test's field names if the export differs from the Muse schema.
4. **Adapter: written and checked on live data 2026-11-08** (`packages/engine/src/intervals.ts`; power zones now read by id, 27 tests pass). The `vo2 heartrate` rides were confirmed real (2026-11-08). The throwaway web Home POC is built in `apps/poc-web/`. **Next:** connect the plan so recovery weeks score correctly, add power to the scorecard, then the SwiftUI Home. Original note: (see the POC plan in the 2026-11-08 chat), before the SwiftUI build. Eventually: build a v0 Home screen in SwiftUI, fed by real data from the engine. This replaces the old "v0 page on localhost" step.

## Later

- **Replan engine.** It weighs the variables from the brainstorm: day of week, historical ride times, weather windows against actual ride times, morning cold (confidence drops below 50°F; below 40°F means trainer or skip), daylight, the family calendar (read-only), a trainer-OK tag per workout, and a 3 pm early-exit window that Narji declares. It never reads the work calendar. Replan proposes and never moves anything on its own.
- **6:05 am push job.** It looks forward only and never opens with a miss.
- **"Sweetspot Ops" view** for AI accuracy and error bars, separate from the athlete app.
- **Public demo,** designed together with the website redesign.

## You

- Nothing open. The Training calendar belongs to a Gmail account Narji owns for his agents, so it survives turning Muse off (confirmed 2026-11-08).

## Findings to keep in mind

- 21 of 27 rides have device power, but Muse stored only heart-rate zones, so the power rules never ran on real data.
- The HR `categorize()` reproduces all 23 stored categories (checked 2026-11-07).
- 4 rides are family rides with no zones. They stay `unknown`.
