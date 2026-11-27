import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { COOKIE, SESSION_DAYS, readSession, signSession, verifyPassphrase } from "./auth";
import type { Env } from "./env";
import { fail } from "./errors";
import type { LoginStore, WaitlistStore } from "./store";
import type { DataDeps } from "./data";
import { cronRoutes, readRoutes } from "./routes/read";
import { writeRoutes } from "./routes/write";

export interface Deps {
  env: Env;
  logins: LoginStore;
  /** Public signups from the landing page. The route is off when this is absent. */
  waitlist?: WaitlistStore;
  /** Absent in the auth-only tests. */
  data?: DataDeps;
}

const MAX_FAILURES = 5;
const WINDOW_MS = 60_000;
const WAITLIST_MAX_PER_MINUTE = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createApp(deps: Deps) {
  const { env, logins, data, waitlist } = deps;
  const app = new Hono().basePath("/api");

  const cookieOpts = {
    httpOnly: true,
    sameSite: "Strict" as const,
    secure: !env.INSECURE_COOKIES,
    path: "/api",
  };

  app.onError((err, c) => {
    console.error("api error:", err.message);
    return fail(c, 502, "upstream", "Something failed on the server.");
  });

  // Writes must be JSON: with SameSite=Strict this covers CSRF (decision 0002).
  app.use("*", async (c, next) => {
    const m = c.req.method;
    if ((m === "POST" || m === "PUT" || m === "DELETE") && !c.req.path.startsWith("/api/cron/")) {
      const len = c.req.header("content-length");
      const hasBody = len !== undefined && len !== "0";
      if (hasBody && !(c.req.header("content-type") ?? "").startsWith("application/json")) {
        return fail(c, 400, "invalid", "Content-Type must be application/json.");
      }
    }
    await next();
  });

  app.post("/auth/login", async (c) => {
    if ((await logins.recentFailures(WINDOW_MS)) >= MAX_FAILURES) {
      c.header("Retry-After", "60");
      return fail(c, 429, "rate_limited", "Too many tries. Wait a minute.");
    }
    const body = await c.req.json().catch(() => null);
    const passphrase = body && typeof body.passphrase === "string" ? body.passphrase : null;
    if (!passphrase) return fail(c, 400, "invalid", "passphrase is required.");
    const ok = verifyPassphrase(passphrase, env.APP_PASSPHRASE_HASH);
    await logins.record(ok);
    if (!ok) return fail(c, 401, "unauthenticated", "Wrong passphrase.");
    const { token, expiresAt } = await signSession(env.JWT_SECRET);
    setCookie(c, COOKIE, token, { ...cookieOpts, expires: expiresAt, maxAge: SESSION_DAYS * 86_400 });
    return c.body(null, 204);
  });

  // Public: the landing page's waitlist form. Same answer for a new and a repeat email.
  app.post("/waitlist", async (c) => {
    if (!waitlist) return fail(c, 404, "not_found", "Not found.");
    const body = await c.req.json().catch(() => null);
    // `website` is a honeypot field no person fills in. Pretend it worked.
    if (body && typeof body.website === "string" && body.website !== "") return c.body(null, 204);
    const email = body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !EMAIL_RE.test(email)) return fail(c, 400, "invalid", "Enter a valid email address.");
    if ((await waitlist.recentCount(WINDOW_MS)) >= WAITLIST_MAX_PER_MINUTE) {
      c.header("Retry-After", "60");
      return fail(c, 429, "rate_limited", "Too many signups right now. Try again in a minute.");
    }
    await waitlist.add(email);
    return c.body(null, 204);
  });

  // Cron routes check CRON_SECRET instead of the cookie.
  app.use("/cron/*", async (c, next) => {
    if (c.req.header("authorization") !== `Bearer ${env.CRON_SECRET}`) {
      return fail(c, 401, "unauthenticated", "Bad cron secret.");
    }
    await next();
  });

  // Everything else needs the session cookie.
  app.use("*", async (c, next) => {
    if (c.req.path === "/api/auth/login" || c.req.path === "/api/waitlist" || c.req.path.startsWith("/api/cron/")) return next();
    const session = await readSession(env.JWT_SECRET, getCookie(c, COOKIE));
    if (!session) return fail(c, 401, "unauthenticated", "Log in first.");
    c.set("session" as never, session as never);
    await next();
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, COOKIE, cookieOpts);
    return c.body(null, 204);
  });

  app.get("/auth/me", (c) => c.json(c.get("session" as never)));

  if (data) {
    app.route("/", readRoutes(data));
    app.route("/", writeRoutes(data));
    app.route("/cron", cronRoutes(data));
  }

  return app;
}
