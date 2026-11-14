# poc-web

Throwaway POC (2026-11-08). A Home screen fed by the real engine and live intervals.icu data, to check the numbers before the SwiftUI build. Not the product; delete it when the SwiftUI Home exists.

Run from the repo root:

```
node node_modules/.pnpm/vite-node@2.1.9_@types+node@22.20.5/node_modules/vite-node/vite-node.mjs apps/poc-web/server.ts
```

Then open http://localhost:5174. It binds to 127.0.0.1 and reads `.env.local` on the server; credentials never reach the browser.

What's real: weekly goal minutes (endurance, sweet spot, VO2; power zones when a ride has sensor power, HR otherwise) against the targets from `packages/engine/src/targets.ts`, the ride list and categories, and the last four weeks. What's missing on purpose: readiness light, today's workout, lifts, weather, replan (nothing computes those yet). The plan isn't connected, so every goal is judged every week.
