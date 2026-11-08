# Next steps

Updated 2026-11-07, after the UI brainstorm. Keep "Next steps" in [AGENTS.md](../AGENTS.md) in sync with this list.

## Where we are

- Phase 0 is done: intervals.icu access works, Garmin syncs to it directly, and zones and FTP are set there.
- The UI direction is set in [build-writeup/2026-11-07-ui-mocks-v3](build-writeup/2026-11-07-ui-mocks-v3/README.md): a dark theme; a phone-only app; a 6:05 am push as the front door; and Home · [Change the plan] · Calendar.
- The stack is decided (2026-11-08): native SwiftUI plus a TypeScript engine. This replaces the Next.js/Recharts choice in [the technical plan](plans/TECHNICAL-PLAN.md).

## Next session

1. **App stack: decided 2026-11-08.** Native SwiftUI plus a TypeScript engine on a server, phone only. See [decisions/0001-app-stack.md](decisions/0001-app-stack.md). Ask before creating the Apple Developer account.
2. **Engine scaffold: done 2026-11-08.** pnpm workspace, `packages/engine` (TypeScript strict, Vitest).
3. **Port: done except the golden check.** `categorize()`, `weeklyZoneRows()` and `zoneScorecard()` are ported with unit tests. The golden test against the 23 stored categories (`packages/engine/test/muse-golden.test.ts`) skips in the cloud because `data/private/` isn't there. **Run `pnpm test` on your Mac** to confirm it passes, and fix the test's field names if the export differs from the Muse schema.
4. **Next: an intervals.icu adapter** (fetch activities, map `icu_hr_zone_times` and power zones into the engine's types), then a small API and a throwaway web Home screen in `apps/poc-web/` (see the POC plan in the 2026-11-08 chat), before the SwiftUI build. Eventually: build a v0 Home screen in SwiftUI, fed by real data from the engine. This replaces the old "v0 page on localhost" step.

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
