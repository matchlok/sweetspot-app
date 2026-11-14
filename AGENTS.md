# Sweetspot — agent guide

PARA bucket: **Project**. Workspace rules: [../../AGENTS.md](../../AGENTS.md). This file overrides them inside this folder. Claude Code reads it directly; don't add a CLAUDE.md.

## What this is

A training system for time-constrained cyclists, starting with one: Narjit (Cat 3 MTB racer, Morrison CO, ~3.5 h/week). The audience is busy parents who need to land the right workout in a small window, which is the "sweet spot" in the name. It replaces the Muse-hosted Strava adherence tracker: it pulls completed workouts, scores the week by time-in-zone, gives a green/yellow/red readiness light, reshuffles the plan around real life, writes the plan to Google Calendar, and recommends tire pressure at the trailhead. An anonymized, delayed public view embeds into narjitaujla.com.

Portfolio thesis: **an agent that shows its error bars.** Every recommendation is logged with its inputs and a prediction, then scored against what actually happened.

Plan: [docs/plans/TECHNICAL-PLAN.md](docs/plans/TECHNICAL-PLAN.md).

## Non-negotiable rules

1. **Code computes, the LLM proposes.** Zone categories, adherence, load, readiness and tire math are tested TypeScript. Claude writes explanations and proposes reshuffles; the rule gate can block any proposal.
2. **Every recommendation is logged and scored.** Inputs, prompt version, model, output, rule results, prediction, and the outcome once known.
3. **Data source rules.** Strava API data is shown only to Narjit and never used to train a model. Public views use intervals.icu or device data, anonymized and delayed.
4. **Never invent data.** Missing zones mean `unknown`, not a guess. Backfill, don't hand-edit.
5. **Dates are America/Denver.** Compute weekdays; never shift all-day dates across timezones.
6. **Don't overclaim fitness.** A durable threshold effort is "durability improving", not an FTP jump, unless a test says so.
7. **Nothing tied to Narjit's employer.** Ask before installing globally, creating accounts, or spending on APIs.

## Current status

Update when a step finishes or a decision is made.

- **Phase:** 0 done, and the UI direction is set (2026-11-07; see [docs/build-writeup/2026-11-07-ui-mocks-v3](docs/build-writeup/2026-11-07-ui-mocks-v3/README.md)). Stack: a mobile web app (Vite + React, Hono API) plus the TypeScript engine, JWT cookie auth, Postgres (Neon) and hosting on Vercel ([decision 0002](docs/decisions/0002-web-shell-auth-storage.md), 2026-11-13, replacing the SwiftUI choice in 0001). API contract: [docs/plans/API.md](docs/plans/API.md). Engine scaffolded in `packages/engine` (2026-11-08). Goal system (progress/hold/off, auto-recovery) and the web POC Home are built; the Training Google Calendar is connected through the service account (2026-11-08). Screens v4 are drawn and reviewed (2026-11-11; see [docs/build-writeup/2026-11-11-ui-mocks-v4](docs/build-writeup/2026-11-11-ui-mocks-v4/README.md)). Build-order step 1 (calendar reader, planned-weeks rule, dated goal changes, strength matching, not-logged status, fatigue) is done and committed on branch `engine-plan-goals-fatigue` (2026-11-13, not merged). Neon and Vercel accounts exist. Step 2, day options (`packages/engine/src/options.ts`), and step 3, view models and fixtures (`packages/engine/src/views.ts`, 117 tests), are done on the same branch (2026-11-13). `packages/db` (schema, migrations applied to Neon) and the auth secrets are done. `apps/api` auth routes are done (2026-11-13, 6 tests). **Next: the `apps/api` read routes (calendar reader, intervals sync, `ViewData` loaders), then sync and cron, then the web shell.**
- **Next steps (pick up here):** full list in [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md).
  1. ~~Decide the app stack~~ Done: mobile web app + TypeScript engine, phone only (`docs/decisions/0002-web-shell-auth-storage.md`).
  2. ~~Scaffold `packages/engine`~~ Done. `pnpm test` runs Vitest; the Muse golden test needs `data/private/` so it only runs locally.
  3. `categorize()`, `weeklyZoneRows()`, `zoneScorecard()` ported. Golden test passes locally. Adapter in `packages/engine/src/intervals.ts` is checked against live data (2026-11-08); next is a spot-check of the HR-only `vo2` rides.
  4. ~~Build order steps 1 to 3~~ Done 2026-11-13 on branch `engine-plan-goals-fatigue` (not merged): calendar reader, planned-weeks rule, dated goal changes, strength matching, not-logged status, fatigue, day options, view models and fixtures. 117 tests.
  5. **Next: `apps/api` read routes** (build order step 5, second half; auth routes done): read routes that call the `views.ts` functions on live data, sync and cron. `packages/db` and the secrets are done. Add the three auth values to Vercel's environment variables (Narjit) before the first deploy.
  6. Build the API server and web shell from the v4 screens, one screen at a time, to the contract in `docs/plans/API.md`. Colors and sizes come from `docs/build-writeup/2026-11-11-ui-mocks-v4/source/`.
  Rules that bite: intervals.icu owns zones and FTP with no local settings; dates are America/Denver; never print `.env.local` values.

Full history (done, decided, open): [docs/STATUS.md](docs/STATUS.md). Add new entries there; keep only the phase and next action here.

## Folders

- `docs/plans/` plans. `docs/decisions/NNNN-<slug>.md` decision records, each gets a line in `docs/STATUS.md`.
- `data/private/` the Muse export and personal data. Never commit it to a public repo.
- App code (`apps/`, `packages/`) is created in Phase 1, not before.

## Conventions

- `.env.local` format: values unquoted (`KEY=value`), which is also how Vercel stores them. The one exception is `GOOGLE_SERVICE_ACCOUNT_JSON`: it holds spaces and double quotes, so wrap it in single quotes, and paste it into Vercel without them. Node's `--env-file` mis-parses it if it is double-quoted.
- Secrets live in `.env.local` (gitignored): `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`, `ANTHROPIC_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `DATABASE_URL`. Report whether a variable exists, never its value.
- Verify API facts before relying on them and date the note.
- Tone of anything the system writes to Narjit: direct, practical training partner. Flag tempo drift and sequencing costs plainly, once, and leave the call to Narjit.
