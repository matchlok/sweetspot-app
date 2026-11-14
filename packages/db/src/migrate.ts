import { neon } from "@neondatabase/serverless";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Applies migrations/*.sql in order, once each, tracked in `_migrations`.
 * Run from packages/db: `pnpm migrate` (reads ../../.env.local). Prints file
 * names only, never the connection string.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = neon(url);
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

await sql.query("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
const applied = new Set(((await sql.query("select name from _migrations")) as { name: string }[]).map((r) => r.name));

for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(f)) continue;
  const statements = readFileSync(join(dir, f), "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
  for (const s of statements) await sql.query(s);
  await sql.query("insert into _migrations (name) values ($1)", [f]);
  console.log(`applied ${f}`);
}
console.log("migrations up to date");
