// Sets the three auth secrets in .env.local without printing any value.
//   node scripts/setup-auth.mjs            fills what's missing (passphrase prompt only if the hash is missing)
//   node scripts/setup-auth.mjs --reset    asks for a new passphrase and replaces the hash
// JWT_SECRET and CRON_SECRET are random. Only the passphrase is yours to choose.
// Hash format: scrypt:<N>:<r>:<p>:<salt b64url>:<hash b64url> (no "$", so dotenv won't expand it).
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
let text = existsSync(file) ? readFileSync(file, "utf8") : "";
const has = (k) => new RegExp(`^${k}=.+`, "m").test(text);
const set = (k, v) => {
  const line = `${k}=${v}`;
  text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), () => line) : text + (text && !text.endsWith("\n") ? "\n" : "") + line + "\n";
};

function ask(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let s = "";
    stdin.on("data", function onData(c) {
      for (const ch of c) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          return resolve(s);
        }
        if (ch === "\u0003") process.exit(1);
        if (ch === "\u007f" || ch === "\b") s = s.slice(0, -1);
        else s += ch;
      }
    });
  });
}

const reset = process.argv.includes("--reset");
const done = [];

for (const k of ["JWT_SECRET", "CRON_SECRET"]) {
  if (!has(k)) { set(k, randomBytes(48).toString("base64url")); done.push(`${k} generated`); }
  else done.push(`${k} already set`);
}

if (reset || !has("APP_PASSPHRASE_HASH")) {
  if (!process.stdin.isTTY) { console.error("Run this in a real terminal: the passphrase prompt needs a TTY."); process.exit(1); }
  const a = await ask("New passphrase (hidden, 12+ characters): ");
  if (a.length < 12) { console.error("Too short. Nothing written."); process.exit(1); }
  const b = await ask("Again: ");
  if (a !== b) { console.error("They don't match. Nothing written."); process.exit(1); }
  const salt = randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const hash = scryptSync(a.normalize("NFKC"), salt, 32, { N, r, p });
  set("APP_PASSPHRASE_HASH", `scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${hash.toString("base64url")}`);
  done.push("APP_PASSPHRASE_HASH written");
} else done.push("APP_PASSPHRASE_HASH already set");

writeFileSync(file, text);
console.log(done.join("\n"));
console.log("Values are in .env.local only. Add the same three to the Vercel project's environment variables.");
