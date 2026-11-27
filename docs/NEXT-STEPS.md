# Next steps

Updated 2026-11-22. **The work queue is Linear: team SWE, https://linear.app/narjitdev/team/SWE.** Run `/cos` to build the next ready issues and `/review-queue` to review them. Don't keep a numbered to-do list in this file; it goes stale. This file keeps what Linear can't: the decisions and why, where we are, and ideas not yet tracked.

How decisions flow: an issue that needs one is labelled `needs-decision` and carries a "Decisions needed" section (question, options, recommendation). Answer in a comment on the issue or in a prompt. `/cos` moves the answer into "Decisions made". Anything that changes a rule or the product goes into a dated "Decided" section below, and a big one gets a record in `decisions/`.

**On `main` as of 2026-11-21:** the web shell, Strava as a second source, the 2026-11-20 engine rules, own load and fatigue, the readiness pill, Week/Month, pull to refresh, error states, the PWA manifest, strength tags, the program generator (`generateProgram`, SWE-1) and the `programs` and `planned_sessions` tables with repo methods (SWE-2). The SWE-2 migration was applied to Neon (the `sweetspot-dev` branch Production uses) on 2026-11-21.

## Next major feature: program onboarding and the coach

Plan approved 2026-11-21: [plans/ONBOARDING-COACH.md](plans/ONBOARDING-COACH.md). Prototype canvas: https://claude.ai/artifact/5U7s7ZvZTjHV7ZFHwDysD1 (10 screens; the fixed source is in [build-writeup/2026-11-22-onboarding-prototype](build-writeup/2026-11-22-onboarding-prototype/README.md)). The app builds the program, Neon owns the plan, and the calendar becomes a two-week projection. `pnpm --filter api calendar:clear` (dry run; `--yes` deletes) empties the agent-owned calendar to test it. VO2 vanished from the Week page because the Muse-era VO2 series ended 2026-10-22; the generator closes that gap.

Decided 2026-11-21 (Narjit): auto-reshuffle may move sessions inside a week without a tap, and the coach never writes the calendar without one; the plan is written two weeks rolling, each Sunday; a rebuild touches only events the app wrote (tagged `sweetspotProgram`), which is every event once the calendar is wiped; the generator places lift days.

Anthropic API spend for the coach: approved 2026-11-21 (recorded on SWE-14).

Build order, one branch per step, no commits until Narjit reviews. Status lives on the issues.

| Step | Issue |
|---|---|
| Review the prototype, fix screen 5 | SWE-5 (screen 5 fixed 2026-11-22, source in `build-writeup/2026-11-22-onboarding-prototype/`; the 10-screen review is Narjit's) |
| Schema | SWE-2 |
| Generator | SWE-1 |
| Calendar writer and Sunday cron | SWE-3 |
| Read path flip | SWE-10 |
| Program routes | SWE-11 |
| Onboarding screens 1 to 9, end-to-end test | SWE-13 |
| Coach (replaces `/api/replan`) | SWE-14 |

## Other open work

| Work | Issue |
|---|---|
| Check own load on prod | SWE-6 (Narjit) |
| Activity category matching, then auto-reshuffle (through `readWeek`/`crossWeekOptions`, not around them) | SWE-4, then SWE-12 |
| Live cross-week move check on a throwaway series (date this note once checked) | SWE-7 (Narjit) |
| Undo for moves, skips and mark done (four decisions open) | SWE-44 |
| Persist the late-ride re-placement through the calendar writer (it is a derived view only, per STATUS 2026-11-22) | SWE-12 |
| Local live check of each screen against real data | SWE-8 (Narjit) |
| Tune the readiness thresholds after a few weeks of scored readings | SWE-9 |
| `comeback` and `hold` purposes | SWE-17 |
| Migration journal tidy, atomic `createProgram` | SWE-15, SWE-16 |

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

## Rules decided 2026-11-20 (Narjit)

1. **Skip:** a session skipped or not done within its week counts as a miss.
2. **Goal edits** apply from the current week on.
3. **Lifts** never count toward the hit streak.
4. **Moves can cross weeks.** If a session moves out of its week, that week records a miss for it, and the following week does not program another session of that type (no 3/2 counts). Exception (2026-11-22): if the target day is the same day as that week's session of the same kind, nothing is replaced. Both events stay, and `one_ride_per_day` refuses the move rather than doubling the day. This holds for a day chosen by hand too, with no override.
5. **Every week has endurance, sweet spot and VO2.** No alternation. Recovery weeks cut volume to about 60 to 70 percent with the same workouts and the same intensity. The engine's alternating-Tuesday logic and recovery-follows-third-hit-week rule need reworking to match.
6. **Lift counts above 1:** follows rule 4. No extra tracking for overflow.
7. **Readiness pill:** build it now with provisional thresholds from Form, ramp rate and recent hard days, show the inputs on tap, log each reading with a prediction, and score it.

Built 2026-11-21: a skip (or a session moved out of its week) stays planned and is judged, so it is a miss; moves into the following week replace that week's session of the same kind (`readWeek`, `crossWeekOptions`); the fixtures now carry all three sessions every week; the readiness pill and its log are in. Recovery weeks were already volume-only (the factor scales every target, same workouts), so that rule needed no engine change.

## Decided 2026-11-21 (Narjit)

Source: rereading how Muse handled it (`reference/muse/strava_tracker.py`, `data/private/week-plans-export.json`). Muse's matching was deterministic code; the reshuffle was the Muse agent editing the calendar by hand. Neither needs an LLM here.

1. **Two sources, routed by activity type.** intervals.icu supplies everything (zones and power come from Garmin). Strava supplies strength only, configurable with `ACTIVITY_SOURCES`. If both hold the same activity, intervals.icu wins. Built. (Superseded for Zwift: see "Data flow, revised 2026-11-21".)
2. **Match by what was done, not the planned date** (Muse's `_ride_match`, ported to the engine):
   - an exact category match wins;
   - a quality ride (sweet spot or VO2) satisfies either quality session, and the substitution is recorded;
   - an endurance session accepts any categorized ride;
   - a quality session with only an endurance-category ride is a miss;
   - a ride with no zone data counts for endurance if it is 30 minutes or more, so a data gap never creates a miss;
   - off-plan rides still count in the weekly zone minutes.
3. **Lifts are "strength hit" first.** Any strength activity of 15 minutes or more counts as one hit, wherever in the week it falls. A tag then puts it in the upper or lower bucket. Never guess: an untagged lift stays untagged and prompts for a tag.
4. **Tags come from** (a) a code fuzzy match on the Strava private note, description and title (upper, lower, legs, arms, squat, push, pull; "Lift A" is lower and "Lift B" is upper; one-character typos tolerated), read from Strava's single-activity endpoint (the list endpoint omits the note; verified 2026-11-21 that the endpoint returns description and returns `private_note` only when one is set), and (b) a tap in the app.
5. **One Strength bar on Home.** Total target 2 (shows 0/2), with a sub-counter for upper (0/1) and lower (0/1). An untagged lift fills the total and shows "tag it" until it is tagged. Lift goals stay adjustable from 0 to 7 per type ([2026-11-10](#decided-2026-11-10-narjit)); the total is the sum.
6. **The reshuffle applies automatically** (reverses the earlier "replan only proposes"). Once activities are matched, the engine re-plans the rest of the week and writes the moves to the Training calendar itself. This is half the value of the app. Guardrails: the rule gate (`options.ts`) can still block a move; each automatic move is written to the decision log with its inputs; the "What changed?" card shows it; one tap undoes it; it never moves a past or done session, never touches the work calendar, and the 2026-11-20 rules (no alternation, recovery cuts volume only, cross-week moves) govern it. The 6:05 am message reports what moved.
7. **No AI in matching or reshuffling.** Category matching, lift tagging and the reshuffle are tested TypeScript (AGENTS rule 1). Claude's role is the "What changed?" explanation and, later, a fallback tag for a note the fuzzy match can't read.

### Data flow, revised 2026-11-21 (Narjit)

Garmin to intervals.icu only carries rides recorded on Garmin hardware. A Zwift ride uploaded to Garmin Connect reaches Garmin but is not forwarded to intervals.icu (forum reports, e.g. [intervals.icu forum](https://forum.intervals.icu/t/virtual-rides-not-syncing-from-garmin/3689); confirmed here: the Nov 11 and Nov 20 Zwift rides are in Strava and absent from intervals.icu). **Switching Zwift to Garmin Connect is therefore not a fix and is dropped.**

| Source | Provides |
|---|---|
| intervals.icu | Garmin-recorded rides with zone times and the sweet spot bucket; FTP and zone settings (we read them, never hold them); the only source for any public view; a cross-check for our own fatigue numbers |
| Strava | Zwift rides, strength, the private note for lift tags |
| Our engine | Load, CTL, ATL, Form, ramp, matching, reshuffle |

1. **Zwift zones and sweet spot are computed, not read.** For a Strava-sourced ride, fetch the power stream (`/activities/{id}/streams`, one extra call per ride), read FTP and zones from intervals.icu, and compute the seven power zones and sweet spot seconds from it. Fitted method: 1 Hz, stopped samples dropped (Strava `moving`), 5 s trailing mean in whole watts, inclusive zone tops in watts. Sweet spot uses intervals.icu's own `sweet_spot_min/max` (live 84 and 97; our earlier "88 to 94" was wrong), as whole watts floor(FTP x pct). Strava's `/activities/{id}/zones` (verified 2026-11-21: returns sensor-based HR and power distributions for the Zwift and MTB rides) is a cross-check only, because it uses Strava's zone settings and has no sweet spot bucket. No power stream means `unknown`, never a guess.
2. **Golden test (passed 2026-11-21):** the 2026-11-13 MTB ride is in both sources. Compute its zones and sweet spot from the Strava stream and compare with intervals.icu's own `icu_zone_times` and SS. If they differ, fix the method before trusting Zwift rides.
3. **Own load and fatigue.** Per-ride load from normalized power and FTP (Strava's summary has `weighted_average_watts`, so rides with power need no stream for NP), an HR-based estimate for HR-only rides; CTL as a 42-day exponential average of daily load, ATL as 7 days, Form is CTL minus ATL, ramp is the weekly change in CTL. Why: intervals.icu's fatigue numbers undercount because it misses the Zwift rides (Home showed Form 6.1 and a falling ramp on 2026-11-21 despite a week of riding in Strava). Validate against intervals.icu on Garmin-only weeks. Do this before the readiness pill.
4. **Strava stays private.** Anything computed from Strava data is treated as Strava data: shown only to Narjit, never used to train a model, never on a public view. A public view reads intervals.icu or device data only. Re-read the current Strava API agreement before any public view.
5. **Not chosen:** Strava as the only source (loses the sweet spot bucket, the single owner of FTP and zones, and the public-view source), and linking Strava inside intervals.icu (Phase 0 found Strava-sourced rows arrive as stubs with no zone data).

## Earlier assumptions (superseded by the list above)

The 2026-11-11 review assumed an answer for the first four so the screens could be finished. The API contract was written to these assumptions.

1. **Skip counts as a miss** (assumed yes). Otherwise skipping becomes a way to protect the streak.
2. **Goal edits apply from the current week on** (assumed yes). Past weeks keep the targets they were judged against, which fits "never re-judge". Stored as dated rows in `goal_changes`.
3. **Lifts don't affect the hit streak** (assumed yes, as in the engine today).
4. **Moves stay inside the current week** (assumed yes for now).
5. **Recovery weeks against the alternating Tuesday.** Sweet spot and VO2 alternate, and a recovery week follows every third hit week, so recovery always lands on a VO2 week. VO2 would step up half as often as sweet spot, and sweet spot would never get a recovery week. Options: let the recovery week take whichever quality session is due and push the alternation back a week, or count the streak per goal.
6. **Lift counts above 1.** The plan has one upper and one lower event a week. If the count goes to 2, decide whether the app adds the event to the calendar or only tracks the count.
7. **The readiness pill.** HRV, resting HR and sleep are null, so only Form, ramp and recent hard days are available. Either drive the pill from those with provisional thresholds, and show the inputs when it's tapped, or leave it off Home until there is more to base it on. The API returns `readiness: null` until this is decided.

## Build order (original, mostly done; the live queue is Linear)

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
5. **Database and API** (`packages/db` DONE 2026-11-13, `apps/api` auth, read routes, sync and cron DONE 2026-11-13; `vercel.json` and the function entry DONE 2026-11-13, merged and live in Production 2026-11-14 (cron 200, login rejects a wrong passphrase with 401; a real-passphrase login is still to be tried); write routes DONE 2026-11-14 in `apps/api/src/routes/write.ts`, live-checked on a throwaway series; the web shell is next): the Drizzle schema and first migration, Hono with the auth routes, the read routes on live data, and the sync and cron routes. Add `JWT_SECRET`, `APP_PASSPHRASE_HASH` and `CRON_SECRET` to `.env.example`, plus a small script that prints a passphrase hash. Add `vercel.json` for the build, the `/api` function and the cron schedule.
6. **Web shell** (`apps/web`), one screen at a time against fixtures first, then live: design tokens from the [v4 sources](build-writeup/2026-11-11-ui-mocks-v4/source/), login, the tab shell, Home, Calendar, day sheet, Programming, Goal settings. Inter, as in the mocks. Delete `apps/poc-web` once Home works here.
7. **Writes. API half DONE 2026-11-14** (`apps/api/src/routes/write.ts`, 29 API tests; a move and a skip verified on a throwaway series in the real calendar): apply move, swap and skip (one instance, never the series), mark and unmark done, goal and lift saves, the decision log. Still open: a live run of the Postgres decision-id reservation (`reserveDecisionId`), and the web screens that call these routes (they land with step 6).
8. **After the shell:** PWA install and web push for the 6:05 am message (plain notification, no action buttons), "What changed?" with Claude, the month view, post-ride feedback, and performance predictions.

## Still missing

- Screen states listed under "Not mocked yet" in the [v4 write-up](build-writeup/2026-11-11-ui-mocks-v4/README.md): past day done, open day, Home on an open day and after the ride, recovery week, login, loading and offline. Draw them before building the screen they belong to.
- The technical plan: sections 2, 4 and 9 still describe the Next.js dashboard. A note at the top points here; rewrite them once the shell is running.

## Later

- **Replan engine.** It weighs the variables from the brainstorm: day of week, historical ride times, weather windows against actual ride times, morning cold (confidence drops below 50°F; below 40°F means trainer or skip), daylight, the family calendar (read-only), a trainer-OK tag per workout, and a 3 pm early-exit window that Narji declares. It never reads the work calendar. Moves are applied automatically inside the rule gate, logged and undoable (decided 2026-11-21); the weather, daylight and family-calendar inputs above feed it later.
- **6:05 am push job.** It looks forward only and never opens with a miss. Web push, with no service worker on purpose: nothing offline-cached for an authenticated API.
- **Post-ride feedback.** Not designed yet.
- **"Sweetspot Ops" view** for AI accuracy and error bars, separate from the athlete app.
- **Public demo,** designed together with the website redesign.
- **Prediction:** predict whether Narjit will be performant (complete intervals at prescribed power) given the planned workouts, not whether he'll do them. Log and score every prediction.

## Housekeeping

- `apps/poc-web` is deleted (2026-11-21).
- If the app says "Loading�" locally, start both servers fresh; a stale Vite process returned HTML for `/api/*`.
- Migrations: from the repo root run `corepack pnpm --filter @sweetspot/db migrate`. The runner (`packages/db/src/migrate.ts`) applies every `migrations/*.sql` in filename order and records each in `_migrations`; it ignores the Drizzle journal. It writes to the Neon branch Production uses, so Narjit runs it and agents never do.

## Findings to keep in mind

- 21 of 27 rides have device power, but Muse stored only heart-rate zones, so the power rules never ran on real data.
- The HR `categorize()` reproduces all 23 stored categories (checked 2026-11-07).
- 4 rides are family rides with no zones. They stay `unknown`.
- HRV, resting HR and sleep are null in intervals.icu because Garmin isn't sending them.
- The Training calendar's events are all-day recurring series, so the app places them in time itself.
- Strava rides older than the 14-day sync window carry no power or HR fields until a backfill sync, so they count as unknown for own load. The HR-only load estimate has a provisional 0.77 factor (`HR_LOAD_FACTOR`, fitted on 8 rides): re-run `apps/api/src/loadcheck.ts` as more accumulate.
