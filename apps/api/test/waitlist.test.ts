import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { memoryLoginStore, memoryWaitlistStore } from "../src/store";

const mk = (withWaitlist = true) => {
  const waitlist = memoryWaitlistStore();
  const app = createApp({
    env: { JWT_SECRET: "x".repeat(48), APP_PASSPHRASE_HASH: "unused", CRON_SECRET: "cron-secret" },
    logins: memoryLoginStore(),
    ...(withWaitlist ? { waitlist } : {}),
  });
  return { app, waitlist };
};

const json = { "content-type": "application/json" };
const join = (app: ReturnType<typeof mk>["app"], body: unknown) =>
  app.request("/api/waitlist", { method: "POST", headers: json, body: JSON.stringify(body) });

describe("POST /api/waitlist", () => {
  it("is public and stores a trimmed, lowercased email", async () => {
    const { app, waitlist } = mk();
    const r = await join(app, { email: "  Rider@Example.COM " });
    expect(r.status).toBe(204);
    expect([...waitlist.emails.keys()]).toEqual(["rider@example.com"]);
  });

  it("answers a repeat signup the same way and stores it once", async () => {
    const { app, waitlist } = mk();
    expect((await join(app, { email: "a@b.co" })).status).toBe(204);
    expect((await join(app, { email: "A@B.co" })).status).toBe(204);
    expect(waitlist.emails.size).toBe(1);
  });

  it("rejects a missing or malformed email", async () => {
    const { app, waitlist } = mk();
    for (const body of [{}, { email: 5 }, { email: "nope" }, { email: "a@b" }, { email: "a b@c.co" }, { email: `${"x".repeat(250)}@b.co` }]) {
      expect((await join(app, body)).status).toBe(400);
    }
    expect(waitlist.emails.size).toBe(0);
  });

  it("quietly drops a filled honeypot", async () => {
    const { app, waitlist } = mk();
    expect((await join(app, { email: "bot@b.co", website: "http://spam" })).status).toBe(204);
    expect(waitlist.emails.size).toBe(0);
  });

  it("limits new signups to 30 a minute", async () => {
    const { app, waitlist } = mk();
    for (let i = 0; i < 30; i++) expect((await join(app, { email: `u${i}@b.co` })).status).toBe(204);
    const r = await join(app, { email: "late@b.co" });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    expect(waitlist.emails.size).toBe(30);
  });

  it("is off when no store is wired, and other routes still need a login", async () => {
    const { app } = mk(false);
    expect((await join(app, { email: "a@b.co" })).status).toBe(404);
    expect((await app.request("/api/auth/me")).status).toBe(401);
  });
});
