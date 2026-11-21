// One-time Strava authorization. Prints no secrets.
//   pnpm --filter @sweetspot/api strava-auth
// Prints a URL. Open it and approve; Strava redirects to this script's own
// listener on localhost:8788, which trades the code for tokens and stores them.
// Needs the Strava app's "Authorization Callback Domain" set to localhost.
import { createServer } from "node:http";
import { connect } from "@sweetspot/db";
import { pgRepo } from "./pgRepo";
import { authorizeUrl, exchangeCode, stravaConfigFromEnv, stravaCredsFromEnv } from "./strava";

const PORT = 8788;
const REDIRECT = `http://localhost:${PORT}/exchange_token`;
const creds = stravaCredsFromEnv();
if (!creds) throw new Error("Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env.local first");
const cfg = stravaConfigFromEnv(pgRepo(connect()))!;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT);
  if (url.pathname !== "/exchange_token") {
    res.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get("code");
  const scope = url.searchParams.get("scope") ?? "";
  try {
    if (!code) throw new Error(`Strava did not approve (${url.searchParams.get("error") ?? "no code"})`);
    if (!scope.includes("activity:read")) throw new Error("The activity access box was unchecked. Run again and leave it checked.");
    await exchangeCode(cfg, code);
    res.writeHead(200, { "content-type": "text/plain" }).end("Strava authorized. You can close this tab.");
    console.log("Strava authorized. Tokens stored in the database.");
    server.close();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    res.writeHead(400, { "content-type": "text/plain" }).end(msg);
    console.error(msg);
    server.close();
  }
});

server.listen(PORT, () => {
  console.log("Open this URL and approve (waiting for the redirect, Ctrl+C to cancel):\n");
  console.log(authorizeUrl(creds.clientId, REDIRECT));
});
