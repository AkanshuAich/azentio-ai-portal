import type { Metadata } from "next";
import { LAB } from "@/content/site";
import { CtaBand, NumberedCard, PageHero, PillLink, Section } from "@/components/site/ui";

export const metadata: Metadata = { title: "AI Lab | azentio.ai" };

export default function LabPage() {
  return (
    <>
      <PageHero
        label="AI Lab"
        first="Experiment Boldly."
        second="Engineer Purposefully."
        lead="Where emerging technologies meet practical challenges. We experiment, prototype, validate, and refine ideas."
      />
      <Section tone="panel">
        <div className="grid gap-5 sm:grid-cols-2">
          {LAB.map((l) => <NumberedCard key={l.n} {...l} />)}
        </div>
        <div className="mt-10">
          <PillLink href="/hackathon/register" variant="dark">Register for the hackathon</PillLink>
        </div>
        <p className="mt-6 text-sm text-muted">
          Internal experiments, prototype notes and employee-only sessions live in the employee portal, not on this page.
        </p>
      </Section>
      <CtaBand />
    </>
  );
}
