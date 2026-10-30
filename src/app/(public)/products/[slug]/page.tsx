import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PRODUCT_DETAIL } from "@/content/site";
import { CtaBand, Eyebrow, Headline, PillLink, Section } from "@/components/site/ui";
import { getDb } from "@/lib/db";
import { getPublicProduct } from "@/lib/public/products";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const product = await getPublicProduct(getDb(), (await params).slug);
  return { title: product ? `${product.name} | azentio.ai` : "Product | azentio.ai" };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Unknown and non-public slugs are indistinguishable.
  const product = await getPublicProduct(getDb(), slug);
  if (!product) notFound();
  const detail = PRODUCT_DETAIL[product.slug];

  return (
    <>
      <section className="bg-navy text-white">
        <div className="mx-auto max-w-[1200px] px-6 pb-20 pt-16">
          <Link href="/products" className="text-sm text-white/60 hover:text-mint">← All products</Link>
          <div className="mt-6"><Eyebrow>{product.category}</Eyebrow></div>
          <Headline as="h1" first={product.name} />
          <p className="mt-6 max-w-2xl text-lg text-white/75">{product.summary}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <PillLink href={`/connect?topic=demo&product=${product.slug}`}>Request a demo</PillLink>
            <PillLink href="/signin" variant="outline">Client sign-in</PillLink>
          </div>
        </div>
      </section>

      {detail && (
        <Section>
          <div className="grid gap-12 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h2 className="text-2xl font-semibold text-ink">What it does</h2>
              <ul className="mt-6 space-y-4">
                {detail.does.map((d) => (
                  <li key={d} className="flex gap-3 text-lg text-text">
                    <span aria-hidden className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-green" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
            <aside className="space-y-6">
              <div className="rounded-az-lg bg-panel p-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-accent-text">Built for</h3>
                <p className="mt-2 text-ink">{detail.audience}</p>
              </div>
              <div className="rounded-az-lg border border-green/60 p-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-accent-text">Human oversight</h3>
                <p className="mt-2 text-ink">{detail.oversight}</p>
              </div>
            </aside>
          </div>
          <p className="mt-12 text-sm text-muted">
            Demonstrations use synthetic data and are clearly labelled as simulated. Product capabilities and release readiness
            must be validated before public marketing or customer commitments.
          </p>
        </Section>
      )}
      <CtaBand />
    </>
  );
}
