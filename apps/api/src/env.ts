/** Secrets are read per request so tests can inject them. Never log values. */
export interface Env {
  JWT_SECRET: string;
  APP_PASSPHRASE_HASH: string;
  CRON_SECRET: string;
  /** Set only on localhost so the cookie works over http. */
  INSECURE_COOKIES?: string;
}

export function readEnv(src: Record<string, string | undefined> = process.env): Env {
  const need = (k: string) => {
    const v = src[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  return {
    JWT_SECRET: need("JWT_SECRET"),
    APP_PASSPHRASE_HASH: need("APP_PASSPHRASE_HASH"),
    CRON_SECRET: need("CRON_SECRET"),
    INSECURE_COOKIES: src.INSECURE_COOKIES,
  };
}
