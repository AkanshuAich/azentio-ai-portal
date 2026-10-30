import { asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { can } from "@/lib/authz/policy";

export interface PublicProduct {
  slug: string;
  name: string;
  category: string;
  summary: string;
}

const toPublic = (r: typeof products.$inferSelect): PublicProduct => ({
  slug: r.slug, name: r.name, category: r.category, summary: r.summary,
});

// The policy engine, not the SQL filter alone, decides what an anonymous visitor may read.
const visibleToVisitor = (r: typeof products.$inferSelect) =>
  can(null, "read", { audience: r.audience }).allow;

export async function listPublicProducts(db: Db): Promise<PublicProduct[]> {
  const rows = await db.select().from(products).orderBy(asc(products.category), asc(products.name));
  return rows.filter(visibleToVisitor).map(toPublic);
}

/** Returns null for an unknown slug AND for a non-public one, so existence is never revealed. */
export async function getPublicProduct(db: Db, slug: string): Promise<PublicProduct | null> {
  const [row] = await db.select().from(products).where(eq(products.slug, slug));
  return row && visibleToVisitor(row) ? toPublic(row) : null;
}
