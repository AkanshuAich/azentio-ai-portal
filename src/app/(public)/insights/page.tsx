import type { Metadata } from "next";
import { INSIGHTS } from "@/content/site";
import { CtaBand, NumberedCard, PageHero, Section } from "@/components/site/ui";

export const metadata: Metadata = { title: "Insights | azentio.ai" };

export default function InsightsPage() {
  return (
    <>
      <PageHero
        label="Insights"
        first="Ideas Worth Exploring."
        second="Perspectives Worth Sharing."
        lead="Practical thinking on applied AI, engineering, product innovation, and responsible enterprise intelligence."
      />
      <Section tone="panel">
        <div className="grid gap-5 sm:grid-cols-2">
          {INSIGHTS.map((i) => <NumberedCard key={i.n} {...i} />)}
        </div>
        <p className="mt-10 rounded-az-lg border border-green/60 p-5 text-ink">
          Looking for what other organisations are learning? Approved, de-identified shared observations are available to
          signed-in clients and employees inside their portal, never on this public page.
        </p>
      </Section>
      <CtaBand />
    </>
  );
}
