import type { Metadata } from "next";
import { PublicForm } from "@/components/site/PublicForm";
import { PageHero, Section } from "@/components/site/ui";
import { getDb } from "@/lib/db";
import { listPublicProducts } from "@/lib/public/products";

export const metadata: Metadata = { title: "Connect | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  const products = await listPublicProducts(getDb());
  // Only a real, public product can be pre-selected; anything else in the URL is ignored.
  const preselected = products.some((p) => p.slug === product) ? product : undefined;

  return (
    <>
      <PageHero
        label="Connect"
        first="Start a Conversation."
        second="Request a Demo."
        lead="Tell us what you'd like to explore. We'll follow up about your enquiry using the email you provide."
      />
      <Section tone="panel">
        <div className="mx-auto max-w-2xl">
          <PublicForm kind="demo" defaultProduct={preselected} products={products.map((p) => ({ slug: p.slug, name: p.name }))} />
        </div>
      </Section>
    </>
  );
}
