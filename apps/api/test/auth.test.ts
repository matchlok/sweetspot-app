import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { memoryLoginStore } from "../src/store";

function hash(pass: string) {
  const salt = randomBytes(16);
  const h = scryptSync(pass, salt, 32, { N: 1024, r: 8, p: 1 });
  return `scrypt:1024:8:1:${salt.toString("base64url")}:${h.toString("base64url")}`;
}

const mk = () =>
  createApp({
    env: { JWT_SECRET: "x".repeat(48), APP_PASSPHRASE_HASH: hash("correct horse battery"), CRON_SECRET: "cron-secret" },
    logins: memoryLoginStore(),
  });

const json = { "content-type": "application/json" };
const login = (app: ReturnType<typeof mk>, passphrase: string) =>
  app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ passphrase }) });

describe("auth", () => {
  it("rejects a wrong passphrase and sets no cookie", async () => {
    const r = await login(mk(), "nope");
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("logs in, sets an httpOnly strict cookie, and /me accepts it", async () => {
    const app = mk();
    const r = await login(app, "correct horse battery");
    expect(r.status).toBe(204);
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\/api/);
    const me = await app.request("/api/auth/me", { headers: { cookie: cookie.split(";")[0]! } });
    expect(me.status).toBe(200);
    expect((await me.json()).user).toBe("narjit");
  });

  it("401s without a cookie or with a forged one", async () => {
    const app = mk();
    expect((await app.request("/api/auth/me")).status).toBe(401);
    expect((await app.request("/api/auth/me", { headers: { cookie: "sweetspot_session=garbage" } })).status).toBe(401);
  });

  it("limits to 5 failures a minute, even for the right passphrase afterwards", async () => {
    const app = mk();
    for (let i = 0; i < 5; i++) expect((await login(app, "bad")).status).toBe(401);
    expect((await login(app, "correct horse battery")).status).toBe(429);
  });

  it("checks the cron secret instead of the cookie", async () => {
    const app = mk();
    expect((await app.request("/api/cron/sync")).status).toBe(401);
    // Authorized, but no route yet: reaches the router's 404, not the auth wall.
    expect((await app.request("/api/cron/sync", { headers: { authorization: "Bearer cron-secret" } })).status).toBe(404);
  });

  it("rejects a non-JSON write body", async () => {
    const r = await mk().request("/api/auth/login", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    expect(r.status).toBe(400);
  });
});
