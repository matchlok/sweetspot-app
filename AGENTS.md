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

- **Phase:** 0 done (2026-11-07). Next is a Phase 1 v0 slice: local weekly zone scorecard.
- **Done (2026-11-07):** Muse export in `data/private/` (strava-db-export.json, week-plans-export.json); reference script at `reference/muse/strava_tracker.py` (read-only reference, don't edit). Training calendar readable via the Google Calendar connector (owner access). HR `categorize()` reproduces all 23 stored categories.
- **Next steps (pick up here):**
  1. Check `pnpm -v` (else use corepack). Scaffold the pnpm workspace: `packages/engine` (TypeScript strict, Vitest) and `apps/web` (Next.js App Router). Ask before any global install.
  2. Port `categorize()` from `reference/muse/strava_tracker.py` into the engine. Test it against the 23 stored categories in `data/private/strava-db-export.json` (`tables.activity_zones` joined to `activities`). Then port `zone_scorecard()` and `weekly_zone_rows()` with the `ZONE_BANDS` from that script.
  3. v0 page on localhost: weekly stacked time-in-zone bars against the scorecard bands. History comes from the Muse export, and rides from 2026-10-08 on come from intervals.icu. `scripts/spike/intervals-spike.mjs` shows the API shape: `icu_hr_zone_times` is 7 values in seconds, and Z5+Z6+Z7 count as Z5. Use Recharts unless Narji prefers Visx.
  4. Later: nightly sync into Postgres, calendar reader/writer, login, readiness light (plan phases 1+).
  Rules that bite: intervals.icu owns zones and FTP with no local settings; dates are America/Denver; never print `.env.local` values.
- **Decided (2026-11-07):** renamed from Project Icarus to Sweetspot; domain sweetspot.bike (to register; verified unregistered 2026-11-07); public repo name `sweetspot-app` (confirm unused on GitHub). Folder renamed to `sweetspot-app` (done 2026-11-07).
- **Decided (2026-11-06):** new project; intervals.icu as the primary data source (HealthKit later, maybe); TypeScript everywhere except a possible SwiftUI app; Claude API spend approved at roughly $5/mo; Apple Developer account deferred until the iOS phase.
- **Done (2026-11-07):** BMAD v6.12.4 installed (`bmm` module, claude-code skills in `.claude/skills/`, config in `_bmad/`, output in `_bmad-output/`). Checked git history: `data/private/` was never committed and is gitignored, so there was nothing to purge.
- **Decided (2026-11-07):** single public repo `sweetspot-app` (already created on GitHub; no remote added locally yet). Personal data stays out via `data/private/` in `.gitignore`.
- **Done (2026-11-07):** Phase 0 spike script `scripts/spike/intervals-spike.mjs` (run with `node --env-file=.env.local ...`). Auth works. The account returned 0 activities for the last 30 days, so no data source is connected yet (Strava link, or Garmin/Wahoo direct). Its default cycling settings differ from Muse: FTP 195 (Muse 190), LTHR 177, HR zone tops 142/158/165/176/181/186/195 (Muse Z2 120-139, Z4 160-178, Z5 179+). Raw output in `data/private/intervals-spike.json`.
- **Done (2026-11-07):** Garmin Connect linked directly to intervals.icu (Strava kept). Re-ran the spike: 5 activities in 30 days, all `GARMIN_CONNECT`, full records with HR zone times. Phase 0 data-access question resolved. Source rule: Garmin direct, never Strava-only.
- **Decided (2026-11-07):** intervals.icu is the only place zones and FTP live. No local zone or FTP settings anywhere in the repo; the app reads them from intervals.icu (per-activity `icu_hr_zones`/`icu_ftp`, plus `/sport-settings` when needed). Current cycling values, set to match Muse today: FTP 190, HR zone tops 119/139/159/178/193/194/195 (intervals.icu rejects equal tops, so Z6/Z7 are 1 bpm slivers; the engine treats Z5+ as Z5+Z6+Z7). 2026-11-07 is the zone/FTP change event: rides before it keep their old zones and are not reclassified. Pre-change values are in `data/private/intervals-sport-settings-backup.json`.
- **Decided (2026-11-07):** zones change over time, and that's normal. The engine takes each ride's stored zones as correct for its date, with no flags or reconciliation across changes. Muse-era history comes from the export, not intervals.icu.
- **Open:** auth library. Add the GitHub remote and push when ready.

## Folders

- `docs/plans/` plans. `docs/decisions/NNNN-<slug>.md` decision records, each gets a line in "Current status".
- `data/private/` the Muse export and personal data. Never commit it to a public repo.
- App code (`apps/`, `packages/`) is created in Phase 1, not before.

## Conventions

- Secrets live in `.env.local` (gitignored): `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`, `ANTHROPIC_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `DATABASE_URL`. Report whether a variable exists, never its value.
- Verify API facts before relying on them and date the note.
- Tone of anything the system writes to Narjit: direct, practical training partner. Flag tempo drift and sequencing costs plainly, once, and leave the call to Narjit.
