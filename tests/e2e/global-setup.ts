import { execSync } from "node:child_process";
import { config } from "dotenv";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_DB_NAME } from "./env";

config({ path: ".env.local" });

/** Recreates the isolated e2e database from the real migrations and seed, so every run starts identical. */
export default async function setup() {
  const base = new URL(E2E_DATABASE_URL);
  base.pathname = "/postgres";
  const admin = postgres(base.toString(), { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${E2E_DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${E2E_DB_NAME}`);
  } finally {
    await admin.end();
  }
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL, PRIVATE_STORAGE_DIR: "./storage-e2e", SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234" };
  execSync("npx drizzle-kit migrate", { env, stdio: "pipe" });
  execSync("npx tsx src/lib/db/seed.ts", { env, stdio: "pipe" });
}
