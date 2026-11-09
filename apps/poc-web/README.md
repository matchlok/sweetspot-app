# poc-web

Throwaway POC (2026-11-08). A Home screen fed by the real engine and live intervals.icu data, to check the numbers before the SwiftUI build. Not the product; delete it when the SwiftUI Home exists.

Run from the repo root:

```
node node_modules/.pnpm/vite-node@2.1.9_@types+node@22.20.5/node_modules/vite-node/vite-node.mjs apps/poc-web/server.ts
```

Then open http://localhost:5174. It binds to 127.0.0.1 and reads `.env.local` on the server; credentials never reach the browser.

What's real: weekly zone minutes (power zones when a ride has sensor power, HR otherwise), the band targets, ride list and categories. What's missing on purpose: readiness light, today's workout, weather, replan (nothing computes those yet). Every week is scored against the normal band because the plan isn't connected.
