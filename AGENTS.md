# Project Icarus — agent guide

PARA bucket: **Project**. Workspace rules: [../../AGENTS.md](../../AGENTS.md). This file overrides them inside this folder. Claude Code reads it directly; don't add a CLAUDE.md.

## What this is

A personal training system for one time-constrained MTB racer (Narjit, Cat 3, Morrison CO, ~3.5 h/week). It replaces the Muse-hosted Strava adherence tracker: it pulls completed workouts, scores the week by time-in-zone, gives a green/yellow/red readiness light, reshuffles the plan around real life, writes the plan to Google Calendar, and recommends tire pressure at the trailhead. An anonymized, delayed public view embeds into narjitaujla.com.

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

- **Phase:** 0, extract from Muse and spike intervals.icu access. Not started.
- **Done (2026-11-07):** Muse export in `data/private/` (strava-db-export.json, week-plans-export.json); reference script at `reference/muse/strava_tracker.py` (read-only reference, don't edit). Training calendar readable via the Google Calendar connector (owner access). HR `categorize()` reproduces all 23 stored categories.
- **Next action:** create an intervals.icu API key (`INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID` in `.env.local`), then write the Phase 0 spike: last 30 days of activities with zone times, and check whether Strava-sourced rides appear. Also confirm intervals.icu HR zones match Muse (Z2 120-139, Z4 160-178, Z5 179+) and FTP 190.
- **Decided (2026-11-06):** new project; intervals.icu as the primary data source (HealthKit later, maybe); TypeScript everywhere except a possible SwiftUI app; Claude API spend approved at roughly $5/mo; Apple Developer account deferred until the iOS phase.
- **Open:** auth library, BMAD install (not installed yet), public repo vs private repo split.

## Folders

- `docs/plans/` plans. `docs/decisions/NNNN-<slug>.md` decision records, each gets a line in "Current status".
- `data/private/` the Muse export and personal data. Never commit it to a public repo.
- App code (`apps/`, `packages/`) is created in Phase 1, not before.

## Conventions

- Secrets live in `.env.local` (gitignored): `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`, `ANTHROPIC_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `DATABASE_URL`. Report whether a variable exists, never its value.
- Verify API facts before relying on them and date the note.
- Tone of anything the system writes to Narjit: direct, practical training partner. Flag tempo drift and sequencing costs plainly, once, and leave the call to Narjit.
