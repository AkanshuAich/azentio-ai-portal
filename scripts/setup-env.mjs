// Creates .env.local from .env.example with freshly generated secrets, so no password is ever committed.
// It never overwrites an existing .env.local.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const target = ".env.local";
if (existsSync(target)) {
  console.log(`${target} already exists, leaving it untouched.`);
  process.exit(0);
}

const password = randomBytes(18).toString("hex");
const secret = randomBytes(32).toString("hex");
const text = readFileSync(".env.example", "utf8")
  .replaceAll("__POSTGRES_PASSWORD__", password)
  .replaceAll("__SESSION_SECRET__", secret);

writeFileSync(target, text, { mode: 0o600 });
console.log(`Created ${target} with a random database password and session secret.`);
