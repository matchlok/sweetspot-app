// Live smoke test: real Neon, Google and intervals.icu, in-process, self-signed cookie. Prints shapes, never secrets.
import { connect } from "@sweetspot/db";
import { createApp } from "./app";
import { signSession } from "./auth";
import { readEnv } from "./env";
import { googleConfigFromEnv } from "./google";
import { pgLoginStore } from "./pgStore";
import { pgRepo } from "./pgRepo";
import { routingFromEnv } from "./routing";
import { intervalsFromEnv, liveSources } from "./sources";
import { stravaConfigFromEnv } from "./strava";

const db = connect();
const repo = pgRepo(db);
const env = readEnv();
const app = createApp({ env, logins: pgLoginStore(db), data: { repo, routing: routingFromEnv(), sources: liveSources(googleConfigFromEnv(), intervalsFromEnv(), stravaConfigFromEnv(repo)) } });
const { token } = await signSession(env.JWT_SECRET);
const get = async (p: string) => {
  const r = await app.request(p, { headers: { cookie: `sweetspot_session=${token}` } });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
};
const home = await get("/api/home");
console.log("home", home.status, JSON.stringify(home.body).slice(0, 1500));
const week = await get("/api/week");
console.log("week", week.status, week.body?.label, week.body?.days?.map((d: any) => `${d.date}:${d.sessions.map((s: any) => s.kind + "/" + s.status).join(",")}`));
const prog = await get("/api/program");
console.log("program", prog.status, JSON.stringify(prog.body).slice(0, 600));
