import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "../src/api";

afterEach(() => vi.unstubAllGlobals());

const reply = (body: BodyInit | null, init: ResponseInit = {}) => vi.fn().mockResolvedValue(new Response(body, init));

describe("request", () => {
  it("returns parsed JSON", async () => {
    vi.stubGlobal("fetch", reply(JSON.stringify({ ok: 1 }), { status: 200 }));
    expect(await request("/api/x")).toEqual({ ok: 1 });
  });

  it("turns an unreachable server into a sentence, not a hang", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(request("/api/x")).rejects.toMatchObject({ status: 0, code: "offline", message: expect.stringContaining("Can't reach") });
  });

  it("rejects a 200 that isn't JSON (a dev server answering with its HTML page)", async () => {
    vi.stubGlobal("fetch", reply("<!doctype html><title>x</title>", { status: 200, headers: { "content-type": "text/html" } }));
    const e = await request("/api/x").catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("bad_response");
  });

  it("reads the server's error message and code", async () => {
    vi.stubGlobal("fetch", reply(JSON.stringify({ error: { code: "conflict", message: "Plan changed." } }), { status: 409 }));
    await expect(request("/api/x")).rejects.toMatchObject({ status: 409, code: "conflict", message: "Plan changed." });
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))),
    );
    const p = request("/api/x").catch((x) => x);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await p).toMatchObject({ code: "timeout" });
    vi.useRealTimers();
  });

  it("treats 204 as no content", async () => {
    vi.stubGlobal("fetch", reply(null, { status: 204 }));
    expect(await request("/api/x", { method: "POST" })).toBeUndefined();
  });
});
