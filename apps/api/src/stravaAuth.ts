// One-time Strava authorization. Prints no secrets.
//   pnpm strava-auth               prints the URL to open in a browser
//   pnpm strava-auth <code>        trades the code from the redirect URL for tokens and stores them
// After approving, the browser lands on http://localhost/exchange_token?code=... (the page won't load; that's fine).
// Copy the value after "code=" from the address bar.
import { connect } from "@sweetspot/db";
import { pgRepo } from "./pgRepo";
import { authorizeUrl, exchangeCode, stravaConfigFromEnv, stravaCredsFromEnv } from "./strava";

const REDIRECT = "http://localhost/exchange_token";
const creds = stravaCredsFromEnv();
if (!creds) throw new Error("Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env.local first");

const code = process.argv[2];
if (!code) {
  console.log("Open this URL, approve, then rerun with the code from the redirect address:\n");
  console.log(authorizeUrl(creds.clientId, REDIRECT));
} else {
  const cfg = stravaConfigFromEnv(pgRepo(connect()))!;
  await exchangeCode(cfg, code);
  console.log("Strava authorized. Tokens stored in the database.");
}
