import { sql } from "drizzle-orm";
import type { Db } from "./client";

/** A transaction handle. It runs the same query builders as the pool. */
export type TenantDb = Pick<Db, "select" | "insert" | "update" | "delete" | "execute">;

/**
 * Runs `fn` in a transaction whose connection is switched to the non-owner role azentio_app with
 * app.current_org set, so Postgres row-level security restricts every tenant table to that organisation.
 *
 * This is a second line of defence BEHIND the application's authorisation checks, not a replacement: if an
 * app-layer query forgets its tenant filter, the database still refuses to return another tenant's rows.
 * Both settings are transaction-local, so they cannot leak onto the next request on a pooled connection.
 */
export async function withTenant<T>(db: Db, orgId: string, fn: (q: TenantDb) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new Error("invalid organisation id");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);
    await tx.execute(sql`set local role azentio_app`);
    return fn(tx as unknown as TenantDb);
  });
}
