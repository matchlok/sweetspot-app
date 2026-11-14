import type { Context } from "hono";

export type ErrorCode = "unauthenticated" | "not_found" | "invalid" | "blocked" | "upstream" | "conflict" | "rate_limited";

export function fail(c: Context, status: 400 | 401 | 404 | 409 | 429 | 502, code: ErrorCode, message: string) {
  return c.json({ error: { code, message } }, status);
}
