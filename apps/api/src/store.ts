/** Login-attempt storage behind an interface, so tests don't need Postgres. */
export interface LoginStore {
  /** Failed attempts in the last `windowMs`. */
  recentFailures(windowMs: number): Promise<number>;
  record(ok: boolean): Promise<void>;
}

export function memoryLoginStore(): LoginStore {
  const rows: { at: number; ok: boolean }[] = [];
  return {
    async recentFailures(windowMs) {
      const since = Date.now() - windowMs;
      return rows.filter((r) => !r.ok && r.at >= since).length;
    },
    async record(ok) {
      rows.push({ at: Date.now(), ok });
    },
  };
}

/** Public waitlist signups. Behind an interface so tests don't need Postgres. */
export interface WaitlistStore {
  /** Stores a lowercased email. A repeat is a no-op, so callers can't tell who is already on the list. */
  add(email: string): Promise<void>;
  /** New signups in the last `windowMs`, for the rate limit. */
  recentCount(windowMs: number): Promise<number>;
}

export function memoryWaitlistStore(): WaitlistStore & { emails: Map<string, number> } {
  const emails = new Map<string, number>();
  return {
    emails,
    async add(email) {
      if (!emails.has(email)) emails.set(email, Date.now());
    },
    async recentCount(windowMs) {
      const since = Date.now() - windowMs;
      return [...emails.values()].filter((at) => at >= since).length;
    },
  };
}
