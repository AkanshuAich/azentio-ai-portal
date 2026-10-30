import type { Metadata } from "next";
import { MEDIA } from "@/content/site";
import { CtaBand, PageHero, Section } from "@/components/site/ui";
import { getDb } from "@/lib/db";
import { listPublicMedia } from "@/lib/public/media";

export const metadata: Metadata = { title: "Media & Videos | azentio.ai" };

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const published = await listPublicMedia(getDb());
  return (
    <>
      <PageHero
        label="Media & Videos"
        first="See the Thinking."
        second="Experience the Technology."
        lead="Product demonstrations, explainers, engineering stories, and ideas in motion."
      />
      <Section tone="panel">
        {published.length > 0 && (
          <div className="mb-12 grid gap-6 sm:grid-cols-2">
            {published.map((m) => (
              <article key={m.id} className="overflow-hidden rounded-az-lg bg-white shadow-[var(--az-shadow-card)]">
                {m.contentType.startsWith("video/") ? (
                  <video controls preload="metadata" className="aspect-video w-full bg-navy" src={`/api/media/${m.id}`} />
                ) : m.contentType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/media/${m.id}`} alt={m.title} className="aspect-video w-full object-cover" />
                ) : null}
                <div className="p-5"><h2 className="text-xl font-semibold text-ink">{m.title}</h2></div>
              </article>
            ))}
          </div>
        )}
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
