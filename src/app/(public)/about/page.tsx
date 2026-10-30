import type { Metadata } from "next";
import { CAPABILITIES } from "@/content/site";
import { CtaBand, Eyebrow, Headline, NumberedCard, PageHero, PillLink, Section } from "@/components/site/ui";

export const metadata: Metadata = { title: "About | azentio.ai" };

export default function AboutPage() {
  return (
    <>
      <PageHero
        label="About"
        first="Intelligence Begins"
        second="With Imagination."
        lead="azentio.ai is where Azentio turns applied AI ideas into working, accountable products, with the clients who use them."
      />
      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow dark={false}>Who we are</Eyebrow>
            <Headline dark={false} first="Part of Azentio," second="focused on applied AI." />
          </div>
          <div className="space-y-5 text-lg text-text">
            <p>
              Azentio builds purpose-built, intelligence-driven technology for banking, insurance, capital markets and
              ERP, serving financial institutions and enterprises across the Middle East, Africa and Asia.
            </p>
            <p>
              azentio.ai is the applied-AI initiative: a place to explore products, experiment in the lab, and learn
              from clients through a governed collaboration portal.
            </p>
            <PillLink href="https://www.azentio.com/" variant="dark">Visit azentio.com</PillLink>
          </div>
        </div>
      </Section>
      <Section tone="panel">
        <Eyebrow dark={false}>How we work</Eyebrow>
        <Headline dark={false} first="Four things" second="we hold together." />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((c) => <NumberedCard key={c.n} {...c} />)}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
