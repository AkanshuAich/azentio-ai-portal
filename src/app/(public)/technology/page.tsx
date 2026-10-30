import type { Metadata } from "next";
import { ARCHITECTURE, TECHNOLOGY } from "@/content/site";
import { CtaBand, Eyebrow, Headline, NumberedCard, PageHero, Section } from "@/components/site/ui";

export const metadata: Metadata = { title: "Technology & Trust | azentio.ai" };

export default function TechnologyPage() {
  return (
    <>
      <PageHero
        label="Technology & Trust"
        first="Built for Intelligence."
        second="Engineered for Trust."
        lead="Reliable data foundations, thoughtful orchestration, secure integration, controlled execution, and transparent governance."
      />
      <Section tone="panel">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TECHNOLOGY.map((t) => <NumberedCard key={t.n} {...t} />)}
        </div>
        <p className="mt-8 text-sm text-muted">
          We describe capabilities, not certifications: security and compliance claims are made only with verified evidence.
        </p>
      </Section>
      <Section tone="dark">
        <Eyebrow>Reference architecture</Eyebrow>
        <Headline first="Intelligence with Governance" second="at Every Layer." />
        <ol className="mt-10 space-y-3">
          {ARCHITECTURE.map((a, i) => (
            <li key={a.layer} className={`rounded-az-lg border p-5 ${i === ARCHITECTURE.length - 1 ? "border-mint bg-navy" : "border-white/15 bg-navy/60"}`}>
              <p className="font-semibold text-white">{a.layer}</p>
              <p className="mt-1 text-sm text-white/65">{a.items}</p>
            </li>
          ))}
        </ol>
      </Section>
      <CtaBand />
    </>
  );
}
