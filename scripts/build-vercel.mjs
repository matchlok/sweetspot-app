// Builds the deploy output in Vercel's Build Output API format (v3):
// .vercel/output/functions/api.func  the bundled Hono API (routes /api/*)
// .vercel/output/config.json         routes + cron
// Vercel runs this as the project's buildCommand. The web shell's static files will go in .vercel/output/static.
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const out = ".vercel/output";
const fn = `${out}/functions/api.func`;
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: ["apps/api/src/vercel.ts"],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Some bundled deps are CommonJS and call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: "nodejs24.x", handler: "index.mjs", launcherType: "Nodejs" }, null, 2),
);
writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [{ handle: "filesystem" }, { src: "/api(?:/.*)?", dest: "/api" }],
      crons: [{ path: "/api/cron/sync", schedule: "0 10 * * *" }],
    },
    null,
    2,
  ),
);
console.log("built .vercel/output");
