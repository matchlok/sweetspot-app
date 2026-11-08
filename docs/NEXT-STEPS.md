# Next steps

Updated 2026-11-07, after the UI brainstorm. Keep "Next steps" in [AGENTS.md](../AGENTS.md) in sync with this list.

## Where we are

- Phase 0 is done: intervals.icu access works, Garmin syncs to it directly, and zones and FTP are set there.
- The UI direction is set in [build-writeup/2026-11-07-ui-mocks-v3](build-writeup/2026-11-07-ui-mocks-v3/README.md): a dark theme; a phone-only app; a 6:05 am push as the front door; and Home · [Change the plan] · Calendar.
- The stack in [the technical plan](plans/TECHNICAL-PLAN.md) (Next.js, with Recharts or Visx) was written before the UI work and is now open again. Narji doesn't want "basic React like every AI app", and the app is phone-only, which leaves the Next.js web dashboard with no clear role.

## Next session

1. **Decide the app stack** with Winston, the BMAD architect, in party mode alongside Sally and John. Record the decision as `docs/decisions/0001-app-stack.md`. The candidates:
   - **Native SwiftUI app plus a TypeScript engine on a server.** Gives action buttons on the notification ("Locked in / Move it / Not today"), widgets, and HealthKit. Costs the $99/yr Apple Developer account, which is deferred: ask before creating it.
   - **SvelteKit PWA** with hand-drawn SVG or D3 charts. No App Store needed. Tapping the notification opens the app.
   - First, verify whether iOS web push supports action buttons. This is still unverified, and it decides between the two.
   - Either way, the engine stays TypeScript, and the dark tokens in `build-writeup/2026-11-07-ui-mocks-v3/kit/theme.css` become the app's design tokens.
2. **Scaffold the engine,** which works with either stack. Check `pnpm -v` (otherwise use corepack), then create a pnpm workspace with `packages/engine` (TypeScript strict, Vitest). Ask before any global install.
3. **Port `categorize()`** from `reference/muse/strava_tracker.py` and test it against the 23 stored categories in `data/private/strava-db-export.json`. Then port `zone_scorecard()` and `weekly_zone_rows()`. These produce the numbers behind the Home ledger and the Calendar zone table.
4. **Build a v0 Home screen in the chosen stack,** fed by real data from the engine. This replaces the old "v0 page on localhost" step.

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
