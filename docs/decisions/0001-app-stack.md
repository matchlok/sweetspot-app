# 0001 — App stack: native SwiftUI + TypeScript engine

Status: accepted, 2026-11-08 (Narji). **Client part superseded 2026-11-13 by [0002](0002-web-shell-auth-storage.md):** a mobile web app instead of SwiftUI, since there is no personal Mac. The engine-on-a-server part still stands.

## Decision

- **Client:** native SwiftUI iPhone app. Phone only; no desktop or web dashboard.
- **Engine:** TypeScript (strict, Vitest) in `packages/engine`, run on a server. Zones, adherence, load, readiness and tire math stay tested code (AGENTS.md rule 1).
- **Public view:** a separate, anonymized, delayed embed for narjitaujla.com. Not part of the athlete app.

## Why

- The 6:05 am push needs action buttons ("Locked in / Move it / Not today"). A desk check on 2026-11-08 found iOS Safari web push does not support notification actions (MDN compat table, OneSignal docs, Apple forum thread dated 2024-11-03). Not verified on a current iOS device.
- Native also gives widgets and HealthKit later.
- Phone-only removes the web dashboard that the Next.js plan assumed.

## Costs and consequences

- Apple Developer Program is $99/yr. Ask before creating the account (AGENTS.md rule 7).
- The cloud sandbox has no Xcode, so SwiftUI code is written here but built and run on Narji's Mac.
- The engine needs an HTTP API the app calls, plus APNs for push. Hosting and auth library are still open.
- Supersedes the Next.js/Recharts choice in `docs/plans/TECHNICAL-PLAN.md`.

## Not done

- No party-mode review with Winston, Sally and John; Narji decided directly.
- No device test of web push actions. Revisit only if native proves too costly.
