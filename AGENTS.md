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

- **Phase:** 0 done, and the UI direction is set (2026-11-07; see [docs/build-writeup/2026-11-07-ui-mocks-v3](docs/build-writeup/2026-11-07-ui-mocks-v3/README.md)). Stack: a mobile web app (Vite + React, Hono API) plus the TypeScript engine, JWT cookie auth, Postgres (Neon) and hosting on Vercel ([decision 0002](docs/decisions/0002-web-shell-auth-storage.md), 2026-11-13, replacing the SwiftUI choice in 0001). API contract: [docs/plans/API.md](docs/plans/API.md). Engine scaffolded in `packages/engine` (2026-11-08). Goal system (progress/hold/off, auto-recovery) and the web POC Home are built; the Training Google Calendar is connected through the service account (2026-11-08). Screens v4 are drawn and reviewed (2026-11-11; see [docs/build-writeup/2026-11-11-ui-mocks-v4](docs/build-writeup/2026-11-11-ui-mocks-v4/README.md)). Build-order step 1 (calendar reader, planned-weeks rule, dated goal changes, strength matching, not-logged status, fatigue) is done and committed on branch `engine-plan-goals-fatigue` (2026-11-13, not merged). Neon and Vercel accounts exist. Step 2, day options (`packages/engine/src/options.ts`), and step 3, view models and fixtures (`packages/engine/src/views.ts`, 117 tests), are done on the same branch (2026-11-13). `packages/db` (schema, migrations applied to Neon) and the auth secrets are done. `apps/api` auth, read routes, sync and cron are done and smoke-tested live (2026-11-13, 14 tests). The write routes (apply move/swap/skip, mark done, save goals and lifts) are built and tested against a fake calendar (2026-11-14, 29 API tests, not yet committed; one move and one skip verified on a throwaway series in the real calendar). `apps/web` is scaffolded with login, the tab shell and a read-only Home (2026-11-14, uncommitted, not yet run in a browser). Calendar, the day sheet, Programming and Goal settings are in too (2026-11-14, uncommitted; the "What changed?" card waits on `/api/replan`). Merged to `main` 2026-11-15. **2026-11-21: all of the above is merged to `main` (PRs #11 to #17). Now building program onboarding and the coach: the generator (SWE-1) and the `programs`/`planned_sessions` schema (SWE-2, migration applied) are in; the calendar writer and Sunday cron (SWE-3), ride category matching (SWE-4) and rescheduling skipped sessions (SWE-24) are approved 2026-11-21 and in PRs; the screen 5 prototype fix (SWE-5) and the same-day cross-week move fix (SWE-22) are approved 2026-11-22; the 2-line calendar tile rule (SWE-37), moves into next week for any session (SWE-23) and late ride matching (SWE-41) are approved 2026-11-22 and in PRs; the move sheet redesign (SWE-42) and skipped-means-not-done (SWE-43) are in PRs (2026-11-27); the program draft and commit routes (SWE-11) are in a PR (2026-11-27), and the onboarding screens (SWE-13) are next; the rest is queued in Linear.** Prod `/api/home` is fixed. Strava is a second source (merged 2026-11-21, PR #11) with Zwift zones computed from power streams. Own load and fatigue (CTL/ATL/Form/ramp from rides in both sources) drives Home Form and the readiness pill (2026-11-21).
- **Next steps:** the work queue is Linear, team `SWE` (https://linear.app/narjitdev/team/SWE). Run `/cos` to build the next ready issues and `/review-queue` to review them. Anything needing Narjit is labelled `needs-decision` with a "Decisions needed" section. [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md) holds the decisions, the state and the plan links; it has no to-do list.
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
