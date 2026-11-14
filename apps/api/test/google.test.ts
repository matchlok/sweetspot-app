import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fetchEvents, type GoogleConfig } from "../src/google";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function cfg(fake: typeof fetch): GoogleConfig {
  return { serviceAccount: { client_email: "svc@example.iam", private_key: pem }, calendarId: "cal@group", fetch: fake };
}

describe("fetchEvents", () => {
  it("exchanges a token, pages through events, and expands instances", async () => {
    const urls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      urls.push(String(url));
      if (String(url).includes("oauth2")) {
        expect(String(init?.body)).toContain("grant_type=urn");
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      }
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
      return String(url).includes("pageToken=p2")
        ? new Response(JSON.stringify({ items: [{ id: "b", start: { date: "2026-11-12" } }] }))
        : new Response(JSON.stringify({ items: [{ id: "a", start: { date: "2026-11-10" } }], nextPageToken: "p2" }));
    }) as unknown as typeof fetch;

    const events = await fetchEvents(cfg(fake), "2026-11-09", "2026-11-15");
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    const q = urls.find((u) => u.includes("/events"))!;
    expect(q).toContain("singleEvents=true");
    expect(q).toContain("showDeleted=true");
    expect(q).toContain("calendars/cal%40group/events");
  });

  it("reports status only on failure", async () => {
    const fake = (async () => new Response("secret body", { status: 403 })) as unknown as typeof fetch;
    await expect(fetchEvents(cfg(fake), "2026-11-09", "2026-11-15")).rejects.toThrow(/HTTP 403/);
  });
});
