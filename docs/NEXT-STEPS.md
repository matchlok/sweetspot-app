# Next steps

Updated 2026-11-13, after finishing build-order steps 1 to 3 in the engine (branch `engine-plan-goals-fatigue`, 117 tests). **Pick up at step 5 (database and API); step 4 only needs the three `.env.local` secrets.** Keep "Next steps" in [AGENTS.md](../AGENTS.md) in sync with this list.

## Where we are

- Phase 0 is done: intervals.icu access works, Garmin syncs to it directly, and zones and FTP are set there.
- The client is a mobile web app with a TypeScript engine behind a small API server ([decision 0002](decisions/0002-web-shell-auth-storage.md), 2026-11-13). It replaces the SwiftUI choice in [0001](decisions/0001-app-stack.md).
- The engine has zone categories, the weekly scorecard, the intervals.icu ride adapter and the goal system (`packages/engine/src/targets.ts`, 44 tests). The Training Google Calendar is readable and writable through the service account.
- The screens to build are [UI mocks v4](build-writeup/2026-11-11-ui-mocks-v4/README.md): Home, Calendar, day sheet, Programming and Goal settings, with navigation Home · Calendar · Programming.

## Decided 2026-11-10 (Narjit)

- A goal is judged only in weeks where the plan has a session that serves it. An off week carries the target over and counts as neither a hit nor a miss.
- The app owns the Training calendar, so events can be renamed to whatever suits the app. Muse's titles don't need to be kept.
- Lift goals are adjustable from 0 to 7 sessions a week per lift type. They stay done or missed, with no weights or reps.
- Starting targets: 90 min endurance, 20 min sweet spot, 8 min VO2.
- Build the app shell screen by screen, with design loops before each build step.

## Decided 2026-11-13 (Narjit)

See [decision 0002](decisions/0002-web-shell-auth-storage.md).

- **Web app, not SwiftUI** (no personal Mac). Vite + React in `apps/web`, a Hono API in `apps/api`, laid out for a phone and installable as a PWA.
- **Auth:** a passphrase login that sets a signed JWT in an httpOnly cookie.
- **Storage:** Postgres on Neon through the Vercel Marketplace, with Drizzle (`packages/db`).
- **Hosting:** Vercel, deploying from `main`, with Vercel Cron for the nightly sync.

The API between the app and the engine is in [plans/API.md](plans/API.md): endpoints, view-model types, calendar writes, sync, the tables and the decision log.

## Rules to confirm

The 2026-11-11 review assumed an answer for the first four so the screens could be finished. The API contract is written to these assumptions.

1. **Skip counts as a miss** (assumed yes). Otherwise skipping becomes a way to protect the streak.
2. **Goal edits apply from the current week on** (assumed yes). Past weeks keep the targets they were judged against, which fits "never re-judge". Stored as dated rows in `goal_changes`.
3. **Lifts don't affect the hit streak** (assumed yes, as in the engine today).
4. **Moves stay inside the current week** (assumed yes for now).
5. **Recovery weeks against the alternating Tuesday.** Sweet spot and VO2 alternate, and a recovery week follows every third hit week, so recovery always lands on a VO2 week. VO2 would step up half as often as sweet spot, and sweet spot would never get a recovery week. Options: let the recovery week take whichever quality session is due and push the alternation back a week, or count the streak per goal.
6. **Lift counts above 1.** The plan has one upper and one lower event a week. If the count goes to 2, decide whether the app adds the event to the calendar or only tracks the count.
7. **The readiness pill.** HRV, resting HR and sleep are null, so only Form, ramp and recent hard days are available. Either drive the pill from those with provisional thresholds, and show the inputs when it's tapped, or leave it off Home until there is more to base it on. The API returns `readiness: null` until this is decided.

## Build order

1. **Plan and goals in the engine. DONE 2026-11-13** (branch `engine-plan-goals-fatigue`; see [STATUS](STATUS.md)). The sub-items below describe what was built. Still to do from this step: run the planned-weeks rule against the Muse history, and check the wellness field names on live data.
   - Calendar reader: expand the recurring series for a week and return sessions with a kind. Read the kind from `extendedProperties.private.sweetspotKind` once events are tagged, and from the title until then. Check the result against the Muse export.
   - Planned-weeks rule and dated goal changes in `targets.ts`.
   - Strength goals: read `WeightTraining` activities in the adapter, match each lift to the planned lift that day, and count sessions per type against a 0 to 7 target.
   - Not-logged detection: a planned session with nothing logged becomes `not_logged` after the day ends (Muse used a 21:00 local guard).
   - Fatigue: Form (CTL minus ATL), ramp rate and weekly load from intervals.icu wellness.
2. **Day options. DONE 2026-11-13** (branch `engine-plan-goals-fatigue`, 96 tests; see [STATUS](STATUS.md)) (`options.ts`, the rule gate pulled forward from Phase 2)
   - Given the week's sessions, one session and an action, return the candidate days, what else moves, and each rule's result, in the `DayOptions` shape.
   - Rules for the first version: no heavy lower lift the day before a quality ride; nothing in the past moves; completed sessions don't move; the long ride keeps the weekend slot unless overridden.
   - Test cases from the Muse history (the Week 4 reshuffle, Oct 26 to Nov 1) and the v4 scenario.
3. **View models and fixtures. DONE 2026-11-13** (`views.ts`, same branch; see [STATUS](STATUS.md)): one pure function per read endpoint, with the v4 scenario committed as fixture JSON in `packages/engine/test/fixtures/`.
4. **Accounts (Narjit): DONE (Neon and Vercel exist, 2026-11-13).** Still needed in `.env.local`: `JWT_SECRET`, `APP_PASSPHRASE_HASH`, `CRON_SECRET`. Original note: create a Vercel account (Hobby), import the GitHub repo, add Neon from the Marketplace, and create a `dev` branch in Neon. Put the dev branch's connection string in `.env.local` as `DATABASE_URL`, and the other secrets in both places (list in decision 0002).
5. **Database and API** (`packages/db` DONE 2026-11-13, `apps/api` next): the Drizzle schema and first migration, Hono with the auth routes, the read routes on live data, and the sync and cron routes. Add `JWT_SECRET`, `APP_PASSPHRASE_HASH` and `CRON_SECRET` to `.env.example`, plus a small script that prints a passphrase hash. Add `vercel.json` for the build, the `/api` function and the cron schedule.
6. **Web shell** (`apps/web`), one screen at a time against fixtures first, then live: design tokens from the [v4 sources](build-writeup/2026-11-11-ui-mocks-v4/source/), login, the tab shell, Home, Calendar, day sheet, Programming, Goal settings. Inter, as in the mocks. Delete `apps/poc-web` once Home works here.
7. **Writes:** calendar writes for move, swap and skip (one instance, never the series); goal and lift saves; "Mark it done"; the decision log.
8. **After the shell:** PWA install and web push for the 6:05 am message (plain notification, no action buttons), "What changed?" with Claude, the month view, post-ride feedback, and performance predictions.

## Still missing

- Screen states listed under "Not mocked yet" in the [v4 write-up](build-writeup/2026-11-11-ui-mocks-v4/README.md): past day done, open day, Home on an open day and after the ride, recovery week, login, loading and offline. Draw them before building the screen they belong to.
- The technical plan: sections 2, 4 and 9 still describe the Next.js dashboard. A note at the top points here; rewrite them once the shell is running.

## Later

- **Replan engine.** It weighs the variables from the brainstorm: day of week, historical ride times, weather windows against actual ride times, morning cold (confidence drops below 50°F; below 40°F means trainer or skip), daylight, the family calendar (read-only), a trainer-OK tag per workout, and a 3 pm early-exit window that Narji declares. It never reads the work calendar. Replan proposes and never moves anything on its own.
- **6:05 am push job.** It looks forward only and never opens with a miss.
- **"Sweetspot Ops" view** for AI accuracy and error bars, separate from the athlete app.
- **Public demo,** designed together with the website redesign.
- **Prediction:** predict whether Narjit will be performant (complete intervals at prescribed power) given the planned workouts, not whether he'll do them. Log and score every prediction.

## Housekeeping

- Stop the POC server (port 5174) if it is still running.

## Findings to keep in mind

- 21 of 27 rides have device power, but Muse stored only heart-rate zones, so the power rules never ran on real data.
- The HR `categorize()` reproduces all 23 stored categories (checked 2026-11-07).
- 4 rides are family rides with no zones. They stay `unknown`.
- HRV, resting HR and sleep are null in intervals.icu because Garmin isn't sending them.
- The Training calendar's events are all-day recurring series, so the app places them in time itself.
