# Next steps

Updated 2026-11-07. Keep "Next action" in [AGENTS.md](../AGENTS.md) in sync with this list.

## You

1. Create an intervals.icu API key (Settings > Developer Settings). Put `INTERVALS_API_KEY` and `INTERVALS_ATHLETE_ID` in `.env.local` at the project root.
2. In intervals.icu, set HR zones to match Muse (Z2 120-139, Z4 160-178, Z5 179+) and FTP 190 W.
3. Check who owns the Training calendar. The events were created by `narjit.agent1@gmail.com` (the Muse agent account). Make sure ownership sits with an account that survives turning Muse off.
4. Decide: private GitHub repo for this project, and the repo split for public code vs private data (see plan, risk 5).

## Claude

1. Phase 0 spike: list the last 30 days of activities with zone times from intervals.icu; report whether Strava-sourced rides appear.
2. Monorepo skeleton (pnpm workspace, `packages/engine`, `evals/`), no network code yet.
3. Port `categorize`, `_ride_match`, `match`, scorecard to TypeScript from `reference/muse/strava_tracker.py`; golden replay against `data/private/strava-db-export.json`.
4. Write down every replay difference. Expected sources: sessions moved by hand in Muse (Nov 1, Nov 3 and Nov 5 are still on original calendar dates).

## Findings to keep in mind

- 21 of 27 rides have device power, but Muse stored only heart-rate zones, so the power rules never ran on real data.
- HR `categorize()` reproduces all 23 stored categories (checked 2026-11-07).
- 4 rides (family rides) have no zones and stay `unknown`.
