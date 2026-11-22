# Plan: program onboarding and the coach

Drafted 2026-11-21 from a PM/UX round-table ([transcript](../../_bmad-output/party-mode/2026-11-21-onboarding-coach.md)). Not built. Nothing here is decided until Narjit reviews it.

## Why

The app should drive the Training calendar. Right now the engine reads the plan *from* Google Calendar, and that plan is Muse-era: five recurring series and 37 one-offs. VO2 stopped showing on the Week page because its series ended on 2026-10-22, and nothing noticed. Building a program inside the app and writing it out fixes that by construction, and gives a fresh-start path the calendar delete script (`pnpm --filter api calendar:clear`) can exercise.

## Principles

1. **Don't ask what the data knows.** FTP, zones, CTL, ride days and weekly hours come from intervals.icu and Strava. The flow asks only two things: what the block is for, and what the week looks like.
2. **The program card is what gets signed.** It lists the goals (mode, start, step), lifts, recovery cadence, the weekly template and the block length. The coach changes the card. Every change passes the rule gate in code (rule 1, AGENTS.md).
3. **Neon owns the plan.** Planned sessions live in a table. The calendar is a projection of the next two weeks: single events, never recurring series, each tagged `sweetspotKind` and `sweetspotProgram`.
4. **Ship without the LLM first.** A deterministic generator builds the card from history and availability. The coach adds negotiation and explanation once Anthropic spend is approved.
5. **Error bars on the forecast.** The preview gives the target path and an expected path at the recent hit rate. Both are logged as a prediction and scored later (rule 2). Targets are not fitness claims (rule 6).
6. **A tap for every calendar write.** The coach proposes and the user commits.

## The flow

Entry points: an empty state (no program in Neon), and Programming → "Build a new program" (a rebuild, prefilled from the current program).

| # | Screen | What it does | Data |
|---|---|---|---|
| 1 | **Welcome** | "Let's build your next block." Says it reads the last 8 weeks first and asks two questions. One button. | none |
| 2 | **What I see** | Read from history: rides a week, hours a week, days usually ridden, FTP and when it was set, current Form/CTL, strength sessions a week. Each line has a quiet "Not right?" tap that opens an inline correction. | intervals.icu, Strava, own load |
| 3 | **This block is for** | Chips: A race (date + type, e.g. Cat 3 XC), Get faster overall, Come back from a break, Hold fitness through a busy stretch. Block length defaults from the choice (race: weeks to race day, capped at 12; otherwise 8). | user |
| 4 | **Your week** | A week strip. Tap a day to cycle Off → 30 → 45 → 60 → 90 → 2 h+. A per-day toggle for Trail / Trainer / Either. A running total against the 8-week average ("3 h 45 min, you've averaged 3 h 30"). Lift slots are separate small pills per day. | user, prefilled from history |
| 5 | **Coach's proposal** | A coach message (2 to 4 sentences, why this mix), then the program card, then chips: Less intensity · More lifting · Fewer trainer days · Explain this · Looks good. A free-text box ("Tell the coach…"). With the coach off, chips make deterministic edits and the box reads "Coach is off. Turn it on in Settings." | generator, coach |
| 6 | **Adjusting** | The same thread after a chip or a message: the coach's reply, a diff on the card (old → new, highlighted), and a rule-gate note when needed ("VO2 the day after the lower lift costs you some VO2 quality. Your call."), flagged once. | coach, rule gate |
| 7 | **Preview** | Weeks 1 and 2 laid out like the Calendar tab, the block strip (W1 W2 W3 R W5 W6 W7 R) with recovery weeks marked, and the forecast: "Sweet spot target reaches 23 min by Dec 14 if every week is hit. At your recent hit rate (6 of 8), expect 22." | engine |
| 8 | **Write to calendar** | States exactly what happens: "Clears 42 events from the Training calendar. Writes 10 sessions for Nov 23 to Dec 6. Weeks after that are written each Sunday." One button, "Start the block". | calendar writer |
| 9 | **Done** | Home with the new week: Today card, goal bars at the new targets, a one-line "Block 1 of 8 started" note. | views |
| 10 | **Coach sheet (later)** | From Programming, the four "What changed?" chips (Cooked, Short on time, Extra time, Something else) open the same coach thread and card, scoped to this week. This replaces a separate `/api/replan`. | coach |

## Generator (deterministic, engine)

`generateProgram(history, availability, purpose) → ProgramCard`, pure and tested.

- Goals start from `DEFAULT_PROGRAM` (endurance hold 90, sweet spot progress 20 +1, VO2 progress 8 +1, threshold off) scaled to available time. Below 2.5 h, endurance drops to hold 60. With a race inside 6 weeks, threshold comes on and sweet spot holds.
- Placement: the longest slot gets endurance. Quality rides (sweet spot, VO2) go on slots of 45 min or more, never on consecutive days, and never the day after a lower-body lift. Lifts go on short or off days. Every progress goal gets a session in every non-recovery week, and a test asserts this (it closes the VO2 gap).
- Recovery week after three all-hit weeks, using the existing streak rule, so the block strip shows recovery weeks as *planned if hit* and not fixed.

## Coach (Claude Messages API with tools)

- Model `claude-opus-5-5` per the technical plan. Tools are thin wrappers over engine functions: `get_history_summary`, `get_card`, `propose_card_edit(diff)` (runs the rule gate and returns pass or flags), `preview_weeks(card)` and `forecast(card)`. No tool writes the calendar.
- Every turn logs inputs, prompt version, model, the proposed diff, the rule results and the forecast (rule 2).
- Tone per AGENTS.md: direct, practical, flags a cost once, leaves the call to Narjit.
- Cost guard: a cap on turns per session, and Sonnet for the chip-only edits if Opus proves expensive. Needs the API spend yes before any of this runs.

## Data changes

- New `programs` table (id, purpose, race date, block length, availability JSON, card JSON, status, created_at). New `planned_sessions` table (program id, date, kind, minutes, title, calendar event id, status).
- `ViewData.plans` reads from `planned_sessions`. The calendar reader stays, but only to pick up moves and skips Narjit makes in Google Calendar by hand.
- Calendar writer: `createEvent` and `deleteEvent` next to `patchEvent` in `apps/api/src/google.ts`, plus a Sunday cron job that writes week N+2.

## Build order

1. **Program in Neon, generator, calendar writer.** Engine and API, behind tests. The Week page reads from Neon.
2. **Onboarding screens 1 to 9** with the coach off (chips make deterministic edits). Test end to end: `calendar:clear`, onboard, check the calendar.
3. **Coach** on screens 5 and 6, after the spend yes.
4. **Coach sheet** from the "What changed?" chips (screen 10).

## Decisions (Narjit, 2026-11-21)

1. Auto-reshuffle may move sessions inside a week without a tap. The coach never writes the calendar without one.
2. Two weeks rolling, written each Sunday night.
3. A rebuild adjusts only events the app wrote (tagged `sweetspotProgram`). After the calendar is wiped that is every event.
4. The generator places lift days. Onboarding doesn't ask for them, so the lift pills on screen 4 become a preference ("keep lifts off this day") if the prototype review keeps them at all.
