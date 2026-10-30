import { desc } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { mediaAssets } from "@/lib/db/schema";
import { can } from "@/lib/authz/policy";

/** Media an anonymous visitor may see: each row is decided by the policy engine, not just a SQL filter. */
export async function listPublicMedia(db: Db) {
  const rows = await db.select().from(mediaAssets).orderBy(desc(mediaAssets.createdAt));
  return rows.filter((r) => can(null, "read", { audience: r.audience, orgId: r.ownerOrgId, entitlement: r.productSlug }).allow);
}
