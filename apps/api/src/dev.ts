import { serve } from "@hono/node-server";
import { connect } from "@sweetspot/db";
import { createApp } from "./app";
import { readEnv } from "./env";
import { googleConfigFromEnv } from "./google";
import { pgLoginStore } from "./pgStore";
import { pgRepo } from "./pgRepo";
import { routingFromEnv } from "./routing";
import { intervalsFromEnv, liveSources } from "./sources";
import { stravaConfigFromEnv } from "./strava";

const port = Number(process.env.PORT ?? 8787);
const db = connect();
const repo = pgRepo(db);
const app = createApp({
  env: { ...readEnv(), INSECURE_COOKIES: "1" },
  logins: pgLoginStore(db),
  data: { repo, routing: routingFromEnv(), sources: liveSources(googleConfigFromEnv(), intervalsFromEnv(), stravaConfigFromEnv(repo)) },
});
serve({ fetch: app.fetch, port }, () => console.log(`api on http://localhost:${port}/api`));
