import Link from "next/link";
import { CAPABILITIES, FEATURED_PRODUCTS, TRUST_PRINCIPLES } from "@/content/site";
import { OrbitArt } from "@/components/site/OrbitArt";
import { CtaBand, Eyebrow, Headline, NumberedCard, PillLink, Section } from "@/components/site/ui";
import { getDb } from "@/lib/db";
import { listPublicProducts } from "@/lib/public/products";

export const dynamic = "force-dynamic";

export default async function Home() {
  const all = await listPublicProducts(getDb());
  const featured = FEATURED_PRODUCTS.map((s) => all.find((p) => p.slug === s)).filter((p) => p !== undefined);

  return (
    <>
      <section className="overflow-hidden bg-navy text-white">
        <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-6 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <Eyebrow>Welcome to azentio.ai</Eyebrow>
            <Headline as="h1" first="Build Intelligence." second="Create Impact." />
            <p className="mt-6 max-w-lg text-lg text-white/75">
              From ideas to intelligent products. From complexity to clarity. From AI potential to meaningful outcomes.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PillLink href="/products">Explore our products</PillLink>
              <PillLink href="/connect?topic=demo" variant="outline">Request a demo</PillLink>
            </div>
          </div>
          <OrbitArt className="mx-auto w-full max-w-[420px]" />
        </div>
      </section>

      <Section>
        <Eyebrow dark={false}>Why azentio.ai</Eyebrow>
        <Headline dark={false} first="Intelligence, Engineered" second="for the Real World." />
        <p className="mt-6 max-w-2xl text-lg text-text">
          AI creates value when it moves beyond experimentation and becomes part of how businesses operate. We build
          intelligent applications combining domain understanding, advanced AI, intuitive experiences, and
          enterprise-grade engineering.
        </p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((c) => <NumberedCard key={c.n} {...c} />)}
        </div>
      </Section>

      <Section tone="panel">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow dark={false}>Built to work. Designed to evolve.</Eyebrow>
            <Headline dark={false} first="Applied AI," second="in production shape." />
          </div>
          <Link href="/products" className="font-semibold text-accent-text underline">See all products →</Link>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {featured.map((p, i) => (
            <NumberedCard key={p.slug} n={String(i + 1).padStart(2, "0")} title={p.name} text={p.summary} href={`/products/${p.slug}`} />
          ))}
        </div>
      </Section>

      <Section tone="dark">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>See it</Eyebrow>
            <Headline first="Don't Just Imagine" second="What AI Can Do." />
            <p className="mt-6 text-white/75">
              Explore real product experiences, intelligent workflows, and ideas brought to life through engineering.
            </p>
            <div className="mt-8"><PillLink href="/media">Watch product showcases</PillLink></div>
          </div>
          <div className="grid aspect-video place-items-center rounded-az-lg border border-white/15 bg-navy text-white/60">
            <span className="text-sm uppercase tracking-widest">Video coming soon</span>
          </div>
        </div>
      </Section>

      <Section>
        <Eyebrow dark={false}>Trust</Eyebrow>
        <Headline dark={false} first="Innovation Without" second="Compromising Trust." />
        <p className="mt-6 max-w-2xl text-lg text-text">Enterprise AI must be as accountable as it is intelligent.</p>
        <ul className="mt-10 grid gap-4 md:grid-cols-2">
          {TRUST_PRINCIPLES.map((t) => (
            <li key={t} className="flex gap-3 rounded-az-lg bg-panel p-5 text-ink">
              <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full bg-green" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Section>

      <section className="bg-card text-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-6 px-6 py-12">
          <div>
            <Eyebrow>Upcoming hackathon</Eyebrow>
            <p className="mt-2 text-2xl font-semibold">Start with an idea.</p>
            <p className="mt-1 text-white/70">Register your interest in building, experimenting, and collaborating.</p>
          </div>
          <PillLink href="/hackathon/register">Register interest</PillLink>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
