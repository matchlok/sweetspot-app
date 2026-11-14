import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export * from "./schema";
export { schema };

/** One client per call site; neon-http is stateless, so this is cheap in a serverless function. */
export function connect(databaseUrl: string | undefined = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(databaseUrl), { schema });
}

export type Db = ReturnType<typeof connect>;
