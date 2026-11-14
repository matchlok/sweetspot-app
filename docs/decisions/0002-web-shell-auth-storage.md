# 0002 — Web app on Vercel, JWT auth, Postgres

Status: accepted, 2026-11-13 (Narjit). Supersedes the client part of [0001](0001-app-stack.md). Storage changed from JSON files to Postgres the same day, before any code was written.

## Decision

1. **Client: a mobile web app (PWA), not SwiftUI.** Narjit has no personal Mac, and SwiftUI needs Xcode. The app is still phone-first and laid out for 390 px wide, as in the v4 screens. It installs to the iPhone home screen as a PWA.
2. **Stack:**
   - `apps/web`: Vite + React + TypeScript (strict). It replaces `apps/poc-web`, which is deleted once Home works in `apps/web`.
   - `apps/api`: a [Hono](https://hono.dev) app serving the JSON API under `/api`. It runs as a Vercel Function when deployed and on plain Node locally (`@hono/node-server`).
   - `packages/engine`: unchanged. Pure TypeScript with no I/O; `apps/api` does all fetching and storage.
   - `packages/db`: the Drizzle ORM schema and migrations (drizzle-kit).
3. **Auth: a signed JWT in an httpOnly cookie, after a passphrase login.** This is the standard pattern for a single-user web app.
   - Login: `POST /api/auth/login` with a passphrase. The server compares it against `APP_PASSPHRASE_HASH` (scrypt from `node:crypto`, so no native dependency). Limit to 5 failed attempts a minute, counted in Postgres since functions don't share memory.
   - Token: a JWT signed HS256 with `JWT_SECRET`, using the `jose` library. Claims: `sub: "narjit"`, `iat`, `exp` at 30 days. No refresh token; log in again after 30 days.
   - Cookie: `httpOnly`, `SameSite=Strict`, `Secure` everywhere except localhost, `Path=/api`. The token never reaches JavaScript.
   - Every `/api` route except login checks the cookie. Write routes also require `Content-Type: application/json`, which with `SameSite=Strict` covers CSRF. Cron routes check `CRON_SECRET` instead.
   - Logging out everywhere means rotating `JWT_SECRET`.
4. **Storage: Postgres on Neon, added through the Vercel Marketplace** (free tier). Vercel puts `DATABASE_URL` into the project's environment. Locally, `DATABASE_URL` in `.env.local` points at a separate Neon development branch, so local work never touches the deployed data. Use the `@neondatabase/serverless` driver with Drizzle. Tables are in [the API contract](../plans/API.md#storage).
5. **Hosting: Vercel**, one project from the GitHub repo. The `apps/web` build is served as static files and `apps/api` as a function under `/api`. Every push to `main` deploys; branches get preview URLs. Vercel Cron runs the nightly sync.

## Why

- Web is the only client Narjit can build and run without new hardware.
- A cookie JWT needs no user database, no third-party auth service, and carries over to a native client if one happens.
- Postgres on Vercel gives a reachable app from the phone anywhere, with no server to run. Drizzle migrations keep the schema changes reviewable while the format still moves.
- Hono runs the same code on Vercel Functions and on local Node.

## Costs and consequences

- **Push notifications lose their action buttons.** iOS web push works only for a PWA added to the home screen (iOS 16.4 and later), and it has no action buttons, which was the reason for 0001. The 6:05 am push becomes a plain notification; tapping it opens Home, where "Locked in", "Move it" and "Not today" live. Push is not part of the shell build.
- **No HealthKit.** HRV, resting HR and sleep come from intervals.icu only, if Garmin starts sending them.
- **Accounts:** a Vercel account (Hobby, free) with the Neon integration. Narjit creates them; the free tiers cover one user. Hobby allows cron jobs at most once a day, which suits the nightly sync. The 6:05 am push will need a plan check when it's built.
- **Cold starts.** Neon's free tier suspends the database when idle, so the first request of the morning can take a second or two.
- **Secrets in two places:** `.env.local` for local work, and the Vercel project's environment variables for deploys. Same names in both: `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_ID`, `DATABASE_URL`, `JWT_SECRET`, `APP_PASSPHRASE_HASH`, `CRON_SECRET`. Add the new ones to `.env.example` with empty values.
- The Apple Developer account ($99/yr) is no longer needed.
