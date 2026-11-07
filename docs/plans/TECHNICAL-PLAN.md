# Sweetspot — technical plan

Drafted 2026-11-06. Status: draft for review. Decisions behind it are in [AGENTS.md](../../AGENTS.md) "Current status".

## 1. Goal and scope

Replace the Muse-hosted Strava adherence tracker with a system Narjit owns, and make it a portfolio piece.

**In scope**

| # | Requirement | Phase |
|---|---|---|
| R1 | Ingest completed workouts (rides, trainer rides, lifts) with time-in-zone, automatically | 1 |
| R2 | Port the Muse engine: categorize rides, match planned sessions, weekly zone scorecard, recovery weeks | 1 |
| R3 | Plan lives in Google Calendar; the system moves sessions there (mark-and-reshuffle) | 1 |
| R4 | Private dashboard behind a login | 1 |
| R5 | Post-workout feedback in under 10 seconds: RPE, feel, notes, tire feel | 2 |
| R6 | Daily readiness light (green/yellow/red) and weekly volume light, each showing the inputs behind it | 2 |
| R7 | Claude proposes plan changes with a written reason; a rule gate approves or blocks them | 2 |
| R8 | Every recommendation stores a prediction that gets scored later; a calibration view | 2 |
| R9 | Trailhead mode: pick a saved location, get a tire pressure ± uncertainty from conditions; skipped for trainer rides | 3 |
| R10 | Tire model learns per location and condition from ride feedback, with a readable "training report" | 3 |
| R11 | Public, anonymized, delayed dashboard embeddable in narjitaujla.com | 4 |
| R12 | Optional SwiftUI app: HealthKit HRV/sleep, quick feedback, trailhead mode | 5 |

**Out of scope for now:** other users linking accounts, suspension setup, training a model on Strava data, a full TrainingPeaks replacement (structured workout builder, device push).

## 2. Architecture

```
intervals.icu ──(poll + webhook if available)──┐
Strava webhook (trigger only, private view) ───┤
Open-Meteo (weather, soil moisture, elevation) ┤
Jeffco Open Space alerts (closures) ───────────┤
                                               ▼
                    apps/web  (Next.js on Vercel)
        ┌──────────────── route handlers / cron ───────────────┐
        │ ingest → engine (pure TS) → rule gate → Claude call  │
        │        → calendar writer → decision log              │
        └──────────────────────────────────────────────────────┘
                 │                        │
          Postgres (Neon)          Google Calendar "Training"
                 │
     ┌───────────┴────────────┐
 private dashboard      /api/public/* (anonymized, delayed)
 (login)                       │
                       narjitaujla.com embed
```

### Repo layout (pnpm workspace, created in Phase 1)

```
apps/web/            Next.js app: dashboard, API routes, cron jobs
packages/engine/     pure TypeScript, no I/O: categorize, match, scorecard,
                     load (CTL/ATL/TSB), readiness, rule gate, reshuffle, tire model
packages/db/         Drizzle schema + migrations
packages/agent/      Claude prompts, output schemas, prompt versions
evals/               golden replay, rule-gate cases, proposal evals, calibration reports
apps/ios/            SwiftUI, Phase 5 only
```

Putting the engine in its own package with no I/O makes it testable against the Muse history, reusable from cron and API routes, and keeps the rules separate from the LLM.

### Stack choices

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language across engine, API and web; Narjit prefers it |
| Web | Next.js App Router on Vercel | Portfolio is already Next.js; cron and route handlers included |
| DB | Postgres on Neon + Drizzle ORM | Free tier, typed schema, plain SQL when needed |
| Auth | Auth.js or Better Auth, single-user allowlist, passkey + GitHub | Auth practice without a third-party user store. Pick in Phase 1 (open) |
| Tests | Vitest | Fast, works with the engine package |
| LLM | Claude Messages API, `claude-opus-5-5`, structured output | One decision per event; no agent loop needed |
| Calendar | Google Calendar API via a service account with edit access to the Training calendar | No OAuth flow for a single user |
| Charts | Visx or Recharts | Decide with the dashboard design |

## 3. Data sources

| Source | Gives | Notes / to verify |
|---|---|---|
| **intervals.icu API** (personal key) | Activities, HR/power zone times, streams, CTL/ATL/TSB, wellness (HRV, resting HR, sleep, if synced) | **Verify first (Phase 0):** activities that reach intervals.icu *from Strava* may be hidden from its API because of Strava's terms. If so, connect Garmin/Wahoo directly to intervals.icu. |
| Strava API | New-activity webhook, activity names | Show only to Narjit. Never use for model training. New apps start capped at very few athletes. |
| Google Calendar API | Planned sessions, recurring series | Series master IDs from the Muse doc carry over |
| Open-Meteo | Temperature, precipitation history, soil moisture, elevation | Free, no key. Feeds tire model and context |
| Jeffco Open Space alerts page | Mud closures | Check the page's terms before scraping; fall back to manual "trail closed" flag |
| Muse export | `strava.db`, `strava_tracker.py`, week-N plan docs, FTP and zone settings | One-time import. Irreplaceable history |
| HealthKit | HRV, sleep, resting HR | Phase 5, only if the iOS app happens |

## 4. Data model (first cut)

Carried over from Muse: `activities`, `activity_zones`, `planned_sessions`, `adherence`, `sync_state`.

New:

- `athlete_settings` (versioned): FTP, HR zones, power zones, weekly time budget, scorecard bands. Every derived row records which settings version it used.
- `wellness_daily`: HRV, resting HR, sleep, source.
- `feedback`: per activity. RPE 1–10, feel (ordinal), notes, tire feel per wheel (`squirmy | right | harsh | burped | rim_strike`).
- `readiness_snapshots`: date, light, each input value, rule hits, explanation text.
- `decisions`: trigger, inputs hash, prompt version, model, raw proposal JSON, rule-gate results, final status (`applied | blocked | needs_review`), calendar changes made.
- `predictions`: decision id, what was predicted (e.g. expected RPE, expected Z4 minutes, pressure feel), predicted value with interval, actual value, scored_at, error.
- `locations`: name, coordinates (private), elevation, surface type, public alias.
- `bike_setups`: bike, tire model and width, rim inner width, casing, tubeless.
- `pressure_sessions`: location, setup, conditions snapshot, recommended front/rear ± interval, actual set front/rear, link to feedback.

## 5. Engine (packages/engine)

### 5.1 Port from Muse (Phase 1)

Port `categorize()`, `_ride_match()`, `match()`, `zone_scorecard()`, `weekly_zone_rows()`, `focus_hints()`, recovery-week detection and the lift rules exactly as documented in the Muse prompt (power first, then HR; HR-lag path; quality↔quality substitution; unknown ≥ 30 min satisfies endurance/easy spin; 21:00 local guard; never re-judge).

**Golden replay (exit gate):** load the Muse `strava.db`, run the TS engine over every activity and planned session, and diff against stored `category` and `adherence.status`. 100% match, or each difference written down and explained (e.g. a manual correction in Muse). This is eval suite #1.

Fix Muse quirks while porting, each as its own tested change *after* replay passes:
- Calendar edits to existing sessions sync automatically (no manual SQL).
- Add a `threshold` category, or keep `sweet_spot` as today. Decide after looking at the data.
- Lift logging friction: let a feedback entry mark "lift done" when Strava shows nothing.

### 5.2 Load and readiness (Phase 2)

- Load: take CTL/ATL/TSB from intervals.icu, recompute locally as a cross-check.
- **Weekly volume light** (the "optimal volume for my lifestyle" view): time vs budget, scorecard bands (easy floor, quality 12–30 min, recovery-week rules), tempo-drift flag, ramp rate.
- **Daily readiness light:** TSB band, HRV vs 7-day and 60-day baseline, resting HR vs baseline, sleep, last RPE vs expected RPE, consecutive hard days. Each rule outputs `green | yellow | red` plus a reason; the light is the worst result, and the UI lists every rule.
- Thresholds start as provisional config values. They are tuned against the predictions log, not guessed once.

### 5.3 Rule gate (Phase 2)

Hard checks any proposal must pass before the calendar changes:
- Weekly time ≤ budget (plus a small tolerance).
- Heavy lower-body lift never the day before a quality ride.
- No more than one quality ride in recovery weeks; Saturday endurance ≤ 1 h in recovery weeks.
- Ramp rate and acute:chronic load within caps.
- Doesn't move already-completed sessions or anything in the past.
- Only the single weekend ride slot holds the long ride unless Narjit overrides.

Failing a check → `blocked` with the reason, shown in the decision log. Rules are unit-tested with cases from the Muse history (e.g. the Week 4 reshuffle of Oct 26–Nov 1, 2026).

### 5.4 Tire model (Phase 3)

Not a trained neural model. Too little data, and no open dataset links pressure to outcomes.
1. **Baseline:** formula from system weight, tire width, rim width, casing, tubeless, terrain class. Front/rear split.
2. **Condition adjustments:** temperature at trailhead vs where the tire was pumped (gas law), wet/dusty from precipitation history and soil moisture, altitude.
3. **Learned offset:** per location (and per condition bucket once there's enough data), a Bayesian normal-normal update from ordinal feedback (`squirmy` → too low, `harsh` → too high, `burped`/`rim_strike` → strongly too low). The prior comes from the baseline; the posterior width is the ± shown at the trailhead.
4. **Training report:** per location, how the recommendation and its uncertainty changed ride by ride, and how often feedback said "right".

Trainer rides skip all of this.

## 6. Claude (packages/agent)

- One Messages API call per trigger, not an agent loop. Triggers: activity judged, feedback submitted, weekly review (Sunday evening), manual "replan my week".
- Input: computed facts only (the week's sessions, scorecard, readiness inputs, constraints Narjit typed in, recent feedback), plus the Muse tone and training rules as the system prompt.
- Output: structured JSON matching a schema: proposed calendar moves, reason per move, predictions for the next sessions (expected RPE, expected zone minutes), short note to Narjit.
- Model `claude-opus-5-5`, explicit effort setting. Verify current request parameters against the API docs when writing the code.
- Prompt versions are files in the repo; each decision row stores the version.
- Cost: about 20K input and 2K output tokens per call, roughly one call a day, about $0.12 per call → about $4/month.

## 7. Evals

| Suite | What | When it runs |
|---|---|---|
| Golden replay | TS engine reproduces Muse verdicts | CI, every change to engine |
| Rule gate | Hand-written allowed/blocked cases | CI |
| Proposal evals | Historical weeks → does Claude's proposal pass the rule gate and match what Narjit actually did? Graded by code first, rubric second | On prompt or model change (costs money; ask first) |
| Calibration | Predictions vs actuals: RPE error, zone-minute error, readiness light vs next-day RPE, tire feel | Weekly report, public chart in Phase 4 |

## 8. Public dashboard and portfolio (Phase 4)

- `/api/public/*` serves only aggregates and anonymized activities.
- Anonymization: no GPS traces (or traces trimmed by a large radius around home and trailheads), locations shown by alias, published with a delay (e.g. 7 days), no exact start times, race efforts shown as power/HR profiles with the event name only if Narjit opts in per race.
- No Strava-API-sourced data on public pages.
- Embed: React components exported from this repo, or an iframe page. Decide with the portfolio revamp.
- The portfolio revamp gets its own PRD in the portfolio repo; this project only owns the public API and embeddable views.

## 9. Phases and exit criteria

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0. Extract and spike | Muse export in `data/private/`; intervals.icu key; spike script listing last 30 days of activities with zone times | Know whether intervals.icu returns the rides (Strava-sourced or device-sourced) with zones. If not, decide on Garmin/Wahoo direct sync |
| 1. Replace Muse | Monorepo, engine port, golden replay, nightly sync, calendar reader/writer, login, private dashboard (week view, scorecard, adherence) | Golden replay passes; nightly sync runs for 7 days unattended; Muse turned off |
| 2. Readiness + agent | Feedback form, readiness and weekly lights, rule gate, Claude proposals, decision log, predictions | Two weeks of proposals logged; zero rule violations reach the calendar |
| 3. Trailhead | Locations, bike setups, conditions fetch, tire model, training report (web/PWA first) | Used at 5 rides; recommendation interval narrows for the most-ridden location |
| 4. Public | Public API, anonymization, calibration chart, embed into the revamped portfolio | Privacy review checklist passes; page live on narjitaujla.com |
| 5. iOS (optional) | SwiftUI app with HealthKit and trailhead mode | Decide after Phase 3. Needs Apple Developer account ($99/yr) for TestFlight |

## 10. Risks and open questions

1. **intervals.icu API access to Strava-sourced activities.** Biggest unknown; Phase 0 resolves it.
2. **Strava terms.** Keep Strava data private and out of any training. Re-read the current API agreement before Phase 4.
3. **Auth library choice** (Phase 1).
4. **BMAD:** install in this project for PRD/architecture work, or keep this plan as the source of truth? Not installed yet.
5. **Repo visibility:** the public portfolio piece wants a public code repo, but `data/private/` must never be public. Likely two repos (private data + public code) or keep data out of git and in the DB only.
6. **Readiness thresholds** are guesses until the calibration log has a few weeks of data. The UI should say so.
7. **Muse history fidelity:** manual corrections made in Muse may make some replay diffs unavoidable. Document each one.
