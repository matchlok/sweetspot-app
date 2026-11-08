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

- **Phase:** 0 done, and the UI direction is set (2026-11-07; see [docs/build-writeup/2026-11-07-ui-mocks-v3](docs/build-writeup/2026-11-07-ui-mocks-v3/README.md)). Stack decided 2026-11-08: native SwiftUI plus a TypeScript engine ([decision](docs/decisions/0001-app-stack.md)). Engine scaffolded in `packages/engine` (2026-11-08). Next: intervals.icu adapter, then a throwaway web POC Home screen.
- **Next steps (pick up here):** full list in [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md).
  1. ~~Decide the app stack~~ Done: SwiftUI app + TypeScript engine on a server, phone only (`docs/decisions/0001-app-stack.md`).
  2. ~~Scaffold `packages/engine`~~ Done. `pnpm test` runs Vitest; the Muse golden test needs `data/private/` so it only runs locally.
  3. `categorize()`, `weeklyZoneRows()`, `zoneScorecard()` ported. Confirm the golden test passes on a machine with `data/private/`. Next: the intervals.icu adapter (API shape in `scripts/spike/intervals-spike.mjs`).
  4. Build a v0 Home screen in the chosen stack, fed by real engine data. Use the dark tokens from `docs/build-writeup/2026-11-07-ui-mocks-v3/kit/theme.css`.
  Rules that bite: intervals.icu owns zones and FTP with no local settings; dates are America/Denver; never print `.env.local` values.

Full history (done, decided, open): [docs/STATUS.md](docs/STATUS.md). Add new entries there; keep only the phase and next action here.

## Folders

- `docs/plans/` plans. `docs/decisions/NNNN-<slug>.md` decision records, each gets a line in `docs/STATUS.md`.
- `data/private/` the Muse export and personal data. Never commit it to a public repo.
- App code (`apps/`, `packages/`) is created in Phase 1, not before.

## Conventions

- Secrets live in `.env.local` (gitignored): `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`, `ANTHROPIC_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `DATABASE_URL`. Report whether a variable exists, never its value.
- Verify API facts before relying on them and date the note.
- Tone of anything the system writes to Narjit: direct, practical training partner. Flag tempo drift and sequencing costs plainly, once, and leave the call to Narjit.
