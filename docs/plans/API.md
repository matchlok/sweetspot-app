# Sweetspot API contract

Drafted 2026-11-13. Status: first version, for the web shell. Stack, hosting, auth and storage are in [decision 0002](../decisions/0002-web-shell-auth-storage.md).

Each screen calls one read endpoint that returns a view model: exactly what the screen shows, already computed. The web app formats and lays out; it never does training math (AGENTS.md rule 1). The view-model types live in `packages/engine/src/views.ts` and are imported by both `apps/api` and `apps/web`, so the two can't disagree about a shape.

## Conventions

- JSON only. Dates are `"YYYY-MM-DD"` in America/Denver; timestamps are ISO 8601 with offset. Durations are whole minutes.
- Errors: HTTP status plus `{ "error": { "code": string, "message": string } }`. Codes: `unauthenticated`, `not_found`, `invalid`, `blocked` (a rule refused a change), `upstream` (intervals.icu or Google failed), `conflict` (the plan changed since the options were computed).
- Every route needs the auth cookie except `POST /api/auth/login`.
- Fixtures: for each read endpoint, `packages/engine/test/fixtures/<view>.json` holds the v4 scenario (Tuesday, Nov 10, week 2, Monday's lift not logged). The web app can run against fixtures with `?fixture=1` in dev, and engine tests assert their view functions return these files.

## Shared types

```ts
type Day = string;                 // "2026-11-10"
type GoalKey = "endurance" | "sweetSpot" | "threshold" | "vo2";
type LiftKey = "upper" | "lower";
type SessionKind = "endurance" | "sweet_spot" | "threshold" | "vo2" | "easy_spin" | "lift_upper" | "lift_lower";
type SessionStatus = "planned" | "done" | "not_logged" | "skipped";

interface Session {
  id: string;                      // Google Calendar instance id
  date: Day;
  kind: SessionKind;
  title: string;                   // "VO2 Max Intervals, trail"
  minutes: number | null;
  detail: string | null;           // "1.5 hr, Z2 and Z3"
  status: SessionStatus;
  doneSource?: "intervals" | "manual";
}

interface GoalBar {
  key: GoalKey | LiftKey;
  label: string;                   // "Endurance", "Upper lift"
  unit: "min" | "sessions";
  actual: number;
  target: number;
  hit: boolean;                    // actual >= target
  nudge?: { text: string; date: Day; sessionId: string };   // "Still open from Monday. Wed or Fri fits."
}

interface OffGoal { key: GoalKey; label: string; text: string }  // "Not planned this week. Back Nov 17 at 22 min."
```

## Auth

| Method and path | Body | Returns |
|---|---|---|
| `POST /api/auth/login` | `{ passphrase }` | `204` and sets the cookie. `401` on a wrong passphrase, `429` after 5 tries a minute |
| `POST /api/auth/logout` | none | `204`, clears the cookie |
| `GET /api/auth/me` | none | `{ user: "narjit", expiresAt }` or `401`. The web app calls this on load to choose between login and Home |

## Reads

### `GET /api/home?date=YYYY-MM-DD`

`date` defaults to today in Denver.

```ts
interface HomeView {
  date: Day;
  weekLabel: string;                       // "week 2 of the program"
  isRecoveryWeek: boolean;
  readiness: null | { light: "green" | "yellow" | "red"; label: string; reasons: string[] };  // null until its inputs are decided
  today: Session | null;                   // null on an open day
  goals: GoalBar[];                        // planned-this-week goals and lifts, in display order
  offGoals: OffGoal[];
  fatigue: null | { form: number; ramp: number | null; load: number | null; note: string | null };   // load is null until a weekly-load source exists
  lastSyncedAt: string;                    // shown as "Updated 6:02 am"
}
```

### `GET /api/week?start=YYYY-MM-DD`

`start` is a Monday and defaults to this week.

```ts
interface WeekView {
  start: Day;
  label: string;                           // "Nov 9 to 15"
  days: { date: Day; isToday: boolean; isPast: boolean; sessions: Session[] }[];
  nextWeekNote: string | null;             // "Sweet spot returns Tuesday at 22 min. VO2 sits out."
}
```

### `GET /api/sessions/:id/options?action=move|swap|skip`

The options behind the day sheet. Computed by the engine's rule gate; effect lines come from templates, not an LLM.

```ts
interface DayOptions {
  session: Session;
  action: "move" | "swap" | "skip";
  planVersion: string;                     // hash of the week's sessions; sent back when applying
  options: {
    id: string;
    heading: string;                       // "Friday, Nov 13"
    effects: { text: string; tone: "plain" | "warn" }[];
    alsoMoves: { sessionId: string; to: Day }[];   // the knock-on changes this option makes
    cta: string;                           // "Move to Friday, lift to Wednesday"
    rules: { rule: string; result: "pass" | "warn" }[];
  }[];
  blocked: { heading: string; reason: string }[];   // days the rules refuse, shown greyed or left out
}
```

For a session with status `not_logged`, `action=move` returns only days left in the current week, and the response adds `canMarkDone: true` for lifts.

### `GET /api/program`

```ts
interface ProgramView {
  goals: { key: GoalKey; label: string; mode: "progress" | "hold" | "off"; target: number; stepMin: number; summary: string }[];
  lifts: Record<LiftKey, number>;          // sessions per week, 0 to 7
  recovery: { streak: number; after: number; factor: number; text: string };
}
```

### `GET /api/goals/:key`

```ts
interface GoalView {
  key: GoalKey;
  label: string;
  definition: string;                      // "Time at 88 to 94% of FTP, power rides only"
  mode: "progress" | "hold" | "off";
  target: number;
  stepMin: number;
  preview: { date: Day; target: number; isRecovery: boolean }[];   // next 6 planned weeks
}
```

The Goal screen redraws the preview as the steppers change, so it also needs `GET /api/goals/:key/preview?mode=&target=&stepMin=` returning `{ preview }` without saving.

## Writes

Every write appends an entry to the decision log (see Storage) with the inputs, the options offered, rule results and the choice. This is what the portfolio thesis rests on.

| Method and path | Body | Effect | Returns |
|---|---|---|---|
| `POST /api/sessions/:id/apply` | `{ action, optionId, planVersion }` | Writes the move, swap or skip to Google Calendar, including `alsoMoves`. Refuses with `409 conflict` if `planVersion` no longer matches | `{ week: WeekView, home: HomeView }` |
| `POST /api/sessions/:id/done` | none | Marks a lift done without a recording (`doneSource: "manual"`) | `{ home: HomeView }` |
| `DELETE /api/sessions/:id/done` | none | Undoes a manual mark | `{ home: HomeView }` |
| `PUT /api/goals/:key` | `{ mode, target, stepMin }` | Saves a goal change effective from the current week. Past weeks keep their targets | `GoalView` |
| `PUT /api/lifts` | `{ upper, lower }` | Lift sessions per week, 0 to 7 each | `ProgramView` |
| `POST /api/sync` | none | Fetches new activities from intervals.icu now (pull to refresh) | `{ lastSyncedAt, newActivities: number }` |

"What changed?" (`POST /api/replan`, Claude) is out of scope for the shell and gets its own section when it's built.

### Calendar writes

Training events are all-day recurring series. A move, swap or skip changes one occurrence, never the series: get the instance through `events.instances`, then patch that instance's `start`/`end` dates (a move) or set `status: "cancelled"` (a skip). Google stores this as an exception on the series. Each written instance gets `extendedProperties.private.sweetspotKind` and `sweetspotDecisionId`, so the reader knows its kind without parsing the title and every change traces back to a log entry.

## Sync

- Activities come from intervals.icu and are stored in the `activities` table. `GET /api/home` and `GET /api/week` fetch new ones first if the last sync is more than 15 minutes old.
- `POST /api/sync` forces a fetch. The web app calls it on pull to refresh.
- Vercel Cron calls `GET /api/cron/sync` nightly (checked with `CRON_SECRET`), so history stays complete when the app isn't opened. It also marks yesterday's unlogged sessions `not_logged`.
- Plan sessions are read from Google Calendar on each request. No cache across requests, since functions don't share memory; add one in Postgres only if it's slow.

## Storage

Postgres on Neon, schema in `packages/db` (Drizzle), changed only through migrations. Timestamps are `timestamptz`; dates are `date` in America/Denver.

| Table | Holds |
|---|---|
| `goal_changes` | One row per saved goal setting: `goal`, `effective_week`, `mode`, `target_min`, `step_min`, `created_at`. The engine replays them in order, so a change never rewrites a judged week. No rows means the `DEFAULT_PROGRAM` targets |
| `program_settings` | Single row: `start_week`, `recovery_after`, `recovery_factor` |
| `lift_targets` | `effective_week`, `upper`, `lower`. No rows means 1 and 1 |
| `manual_done` | `session_id` (primary key), `date`, `kind`, `marked_at`. Deleted on undo |
| `activities` | intervals.icu activities as fetched: `id` (primary key), `date`, `type`, `raw jsonb`, `fetched_at`. Categories and zone minutes are recomputed from `raw` by the engine, never stored, so an engine fix applies to history |
| `sync_state` | Single row: `last_synced_at`, `last_error` |
| `decisions` | Append-only: `id`, `at`, `trigger`, `inputs jsonb`, `options jsonb`, `rule_results jsonb`, `choice jsonb`, `calendar_changes jsonb`, `status` (`applied`, `blocked`, `failed`). Rows are never updated or deleted |
| `login_attempts` | `at`, `ok`. For the 5-a-minute limit; prune rows older than a day |

## Engine changes this contract needs

- `targets.ts`: replay dated goal changes instead of one config from `startWeek`, and take the planned kinds per week (the planned-weeks rule).
- `views.ts`: the types above and one pure function per view, taking fetched data and stored state as arguments.
- `options.ts`: the rule gate and option builder for move, swap and skip.
- Adapter: read `WeightTraining` activities.
