import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fetchEvents, patchEvent, type GoogleConfig } from "../src/google";

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

describe("patchEvent", () => {
  it("moves one all-day instance with an exclusive end date, and tags it", async () => {
    let call: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      call = { url: String(url), init: init! };
      return new Response("{}");
    }) as unknown as typeof fetch;

    await patchEvent(cfg(fake), "series_20261110", { date: "2026-11-30", tags: { sweetspotKind: "vo2", sweetspotDecisionId: "7" } });
    expect(call!.init.method).toBe("PATCH");
    expect(call!.url).toContain("calendars/cal%40group/events/series_20261110");
    expect(JSON.parse(String(call!.init.body))).toEqual({
      start: { date: "2026-11-30" },
      end: { date: "2026-12-01" },
      extendedProperties: { private: { sweetspotKind: "vo2", sweetspotDecisionId: "7" } },
    });
  });

  it("cancels an instance for a skip and reports status only on failure", async () => {
    let body = "";
    const ok = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      body = String(init?.body);
      return new Response("{}");
    }) as unknown as typeof fetch;
    await patchEvent(cfg(ok), "e1", { status: "cancelled" });
    expect(JSON.parse(body)).toEqual({ status: "cancelled" });

    const bad = (async (url: string) =>
      String(url).includes("oauth2") ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 })) : new Response("secret", { status: 404 })) as unknown as typeof fetch;
    await expect(patchEvent(cfg(bad), "e1", { status: "cancelled" })).rejects.toThrow(/HTTP 404$/);
  });
});

describe("createEvent and deleteEvent", () => {
  const tokenOk = (url: string) => (String(url).includes("oauth2") ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 })) : null);

  it("creates one single all-day event with tags and returns its id", async () => {
    let call: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init?: RequestInit) => {
      const t = tokenOk(url);
      if (t) return t;
      call = { url: String(url), init: init! };
      return new Response(JSON.stringify({ id: "new1" }));
    }) as unknown as typeof fetch;
    const { createEvent } = await import("../src/google");
    const id = await createEvent(cfg(fake), { date: "2026-11-30", summary: "VO2", tags: { sweetspotKind: "vo2", sweetspotProgram: "1" } });
    expect(id).toBe("new1");
    expect(call!.init.method).toBe("POST");
    expect(call!.url).toMatch(/calendars\/cal%40group\/events$/);
    const body = JSON.parse(String(call!.init.body));
    expect(body).toEqual({
      summary: "VO2",
      start: { date: "2026-11-30" },
      end: { date: "2026-12-01" },
      extendedProperties: { private: { sweetspotKind: "vo2", sweetspotProgram: "1" } },
    });
    expect(body.recurrence).toBeUndefined();
  });

  it("deletes by id, treats 404 as gone, and reports status only on other failures", async () => {
    const { deleteEvent } = await import("../src/google");
    let call: { url: string; method?: string } | undefined;
    const mk = (status: number) =>
      (async (url: string, init?: RequestInit) => {
        const t = tokenOk(url);
        if (t) return t;
        call = { url: String(url), method: init?.method };
        return new Response(status === 204 ? null : "secret", { status });
      }) as unknown as typeof fetch;
    await deleteEvent(cfg(mk(204)), "e1");
    expect(call).toEqual({ url: expect.stringContaining("calendars/cal%40group/events/e1"), method: "DELETE" });
    await deleteEvent(cfg(mk(404)), "e1");
    await expect(deleteEvent(cfg(mk(500)), "e1")).rejects.toThrow(/HTTP 500$/);
  });
});
