import { scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/** Hash format from scripts/setup-auth.mjs: scrypt:<N>:<r>:<p>:<salt b64url>:<hash b64url>. */
export function verifyPassphrase(passphrase: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(passphrase.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const COOKIE = "sweetspot_session";
export const SESSION_DAYS = 30;
const USER = "narjit";

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(secret: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(USER)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key(secret));
  return { token, expiresAt };
}

export async function readSession(secret: string, token: string | undefined): Promise<{ user: string; expiresAt: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    if (payload.sub !== USER || !payload.exp) return null;
    return { user: USER, expiresAt: new Date(payload.exp * 1000).toISOString() };
  } catch {
    return null;
  }
}
