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
