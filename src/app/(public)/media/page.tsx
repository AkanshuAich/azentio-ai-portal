import type { Metadata } from "next";
import { MEDIA } from "@/content/site";
import { CtaBand, PageHero, Section } from "@/components/site/ui";

export const metadata: Metadata = { title: "Media & Videos | azentio.ai" };

export default function MediaPage() {
  return (
    <>
      <PageHero
        label="Media & Videos"
        first="See the Thinking."
        second="Experience the Technology."
        lead="Product demonstrations, explainers, engineering stories, and ideas in motion."
      />
      <Section tone="panel">
        <div className="grid gap-6 sm:grid-cols-2">
          {MEDIA.map((m) => (
            <article key={m.title} className="overflow-hidden rounded-az-lg bg-white shadow-[var(--az-shadow-card)]">
              <div className="grid aspect-video place-items-center bg-navy text-xs uppercase tracking-widest text-white/60">
                Video coming soon
              </div>
              <div className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-accent-text">{m.tag}</p>
                <h2 className="mt-1 text-xl font-semibold text-ink">{m.title}</h2>
                <p className="mt-1 text-text">{m.text}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-8 text-sm text-muted">
          Only videos approved for a public audience appear here. Client and employee sessions are shown inside their own portals.
        </p>
      </Section>
      <CtaBand />
    </>
  );
}
