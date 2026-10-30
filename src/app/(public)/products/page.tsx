import type { Metadata } from "next";
import { CtaBand, NumberedCard, PageHero, Section } from "@/components/site/ui";
import { getDb } from "@/lib/db";
import { listPublicProducts } from "@/lib/public/products";

export const metadata: Metadata = { title: "Products | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const products = await listPublicProducts(getDb());
  const categories = [...new Set(products.map((p) => p.category))];

  return (
    <>
      <PageHero
        label="Products"
        first="Intelligent Products."
        second="Real-World Purpose."
        lead="Explore a growing portfolio of applied AI experiences, from credit decisioning to reporting and document intelligence."
      />
      <Section tone="panel">
        {categories.map((cat) => (
          <div key={cat} className="mb-14 last:mb-0">
            <h2 className="text-2xl font-semibold text-ink">{cat}</h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {products.filter((p) => p.category === cat).map((p, i) => (
                <NumberedCard key={p.slug} n={String(i + 1).padStart(2, "0")} title={p.name} text={p.summary} href={`/products/${p.slug}`} />
              ))}
            </div>
          </div>
        ))}
        <p className="mt-12 text-sm text-muted">
          Product capabilities and release readiness must be validated before public marketing or customer commitments.
        </p>
      </Section>
      <CtaBand />
    </>
  );
}
