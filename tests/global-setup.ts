import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as s from "../src/lib/db/schema";

config({ path: ".env.local" });

export const TEST_DB_NAME = "azentio_test";

export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set (copy .env.example to .env.local and start docker compose)");
  const u = new URL(base);
  u.pathname = `/${TEST_DB_NAME}`;
  return u.toString();
}

/** Recreates the test database from the real migrations so every run starts clean. */
export default async function setup() {
  const base = new URL(process.env.DATABASE_URL ?? "");
  base.pathname = "/postgres";
  const admin = postgres(base.toString(), { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const client = postgres(testDatabaseUrl(), { max: 1 });
  const db = drizzle(client, { schema: s });
  await migrate(db, { migrationsFolder: "./drizzle" });

  // The single Azentio organisation and the organiser who approves employees.
  const [az] = await db.insert(s.organizations).values({ kind: "azentio", name: "Azentio" }).returning();
  const [organiser] = await db
    .insert(s.users)
    .values({ email: "organiser@azentio.com", displayName: "Organiser", emailVerifiedAt: new Date() })
    .returning();
  await db.insert(s.memberships).values({
    userId: organiser.id, orgId: az.id, role: "employee", status: "active",
    approvedBy: organiser.id, termsAcceptedAt: new Date(),
  });
  await client.end();
}
