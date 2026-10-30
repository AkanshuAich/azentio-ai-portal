import type { Metadata } from "next";
import { PublicForm } from "@/components/site/PublicForm";
import { PageHero, Section } from "@/components/site/ui";

export const metadata: Metadata = { title: "Hackathon registration | azentio.ai" };

export default function HackathonRegisterPage() {
  return (
    <>
      <PageHero
        label="Upcoming azentio.ai hackathon"
        first="Start with"
        second="an idea."
        lead="Register your interest in building, experimenting, and collaborating. Dates and participation details will be announced."
      />
      <Section tone="panel">
        <div className="mx-auto max-w-2xl">
          <PublicForm kind="hackathon" />
        </div>
      </Section>
    </>
  );
}
