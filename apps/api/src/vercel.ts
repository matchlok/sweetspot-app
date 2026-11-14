import { handle } from "@hono/node-server/vercel";
import { connect } from "@sweetspot/db";
import { createApp } from "./app";
import { readEnv } from "./env";
import { googleConfigFromEnv } from "./google";
import { pgLoginStore } from "./pgStore";
import { pgRepo } from "./pgRepo";
import { intervalsFromEnv, liveSources } from "./sources";

// Vercel Function entry. Same wiring as dev.ts, minus INSECURE_COOKIES (cookies stay Secure).
// scripts/build-vercel.mjs bundles this file into .vercel/output/functions/api.func.
const db = connect();
const app = createApp({
  env: readEnv(),
  logins: pgLoginStore(db),
  data: { repo: pgRepo(db), sources: liveSources(googleConfigFromEnv(), intervalsFromEnv()) },
});

export default handle(app);
