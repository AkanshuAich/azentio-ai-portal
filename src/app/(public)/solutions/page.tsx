import type { Metadata } from "next";
import Link from "next/link";
import { SOLUTIONS } from "@/content/site";
import { CtaBand, PageHero, Section } from "@/components/site/ui";
import { getDb } from "@/lib/db";
import { listPublicProducts } from "@/lib/public/products";

export const metadata: Metadata = { title: "Solutions | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function SolutionsPage() {
  const names = new Map((await listPublicProducts(getDb())).map((p) => [p.slug, p.name]));
  return (
    <>
      <PageHero
        label="Solutions"
        first="Real Challenges."
        second="Intelligent Solutions."
        lead="Practical intelligence for financial services and complex enterprise workflows."
      />
      <Section tone="panel">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((s) => (
            <article key={s.n} className="rounded-az-lg bg-white p-6 shadow-[var(--az-shadow-card)]">
              <span className="text-sm font-semibold text-accent-text">{s.n}</span>
              <h2 className="mt-3 text-xl font-semibold text-ink">{s.title}</h2>
              <p className="mt-2 text-text">{s.text}</p>
              <ul className="mt-5 flex flex-wrap gap-2">
                {s.products.filter((p) => names.has(p)).map((p) => (
                  <li key={p}>
                    <Link href={`/products/${p}`} className="rounded-full bg-panel px-3 py-1 text-sm text-ink hover:bg-mint">{names.get(p)}</Link>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
