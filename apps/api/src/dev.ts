import { serve } from "@hono/node-server";
import { connect } from "@sweetspot/db";
import { createApp } from "./app";
import { readEnv } from "./env";
import { pgLoginStore } from "./pgStore";

const port = Number(process.env.PORT ?? 8787);
const app = createApp({ env: { ...readEnv(), INSECURE_COOKIES: "1" }, logins: pgLoginStore(connect()) });
serve({ fetch: app.fetch, port }, () => console.log(`api on http://localhost:${port}/api`));
