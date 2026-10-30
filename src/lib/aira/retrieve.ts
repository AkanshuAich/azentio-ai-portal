import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { airaChunks, contributions, sharedPublications } from "@/lib/db/schema";
import { LIVE } from "@/lib/learning/feed";

export interface Passage {
  n: number;
  publicationId: string;
  title: string;
  offering: string;
  observationPeriod: string | null;
  confidence: string | null;
  /** Reviewed, de-identified text only. */
  text: string;
  /** Internal: used only to judge how many organisations stand behind an answer. Never returned to callers. */
  orgId: string;
}

const STOP = new Set("a an and are as at be by can do does for from how i in is it of on or our so that the this to we what which who with you your about tell me any there their they them has have had was were been being into than then also".split(" "));

export function termsOf(question: string): string[] {
  const t = question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(t)].slice(0, 12);
}

export const MAX_PASSAGES = 6;

/**
 * Retrieval for AIRA. It reads ONLY the retrieval chunks built from approved, shared text, and joins back to
 * the live-visibility rule used by the feed, so a withdrawn, paused or superseded item can never be
 * retrieved even if a stale chunk somehow remained. Private sources, drafts, employee-only content and
 * unreviewed text have no path into this table.
 */
export async function retrieve(db: Db, question: string): Promise<Passage[]> {
  const terms = termsOf(question);
  if (terms.length === 0) return [];
  // Sanitised to letters and digits, so nothing from the question can alter the query structure.
  const tsq = terms.map((t) => `${t.replace(/[^a-z0-9]/g, "")}:*`).filter((t) => t.length > 2).join(" | ");
  if (!tsq) return [];

  const rows = await db
    .select({
      pub: sharedPublications, orgId: contributions.orgId, text: airaChunks.text,
      rank: sql<number>`ts_rank(to_tsvector('simple', ${airaChunks.text}), to_tsquery('simple', ${tsq}))`,
    })
    .from(airaChunks)
    .innerJoin(sharedPublications, eq(sharedPublications.id, airaChunks.publicationId))
    .innerJoin(contributions, eq(contributions.id, sharedPublications.contributionId))
    .where(sql`${LIVE} and to_tsvector('simple', ${airaChunks.text}) @@ to_tsquery('simple', ${tsq})`)
    .orderBy(desc(sql`ts_rank(to_tsvector('simple', ${airaChunks.text}), to_tsquery('simple', ${tsq}))`))
    .limit(30);

  // One best passage per publication, so a single contribution can't crowd out the rest.
  const seen = new Set<string>();
  const out: Passage[] = [];
  for (const r of rows) {
    if (seen.has(r.pub.id)) continue;
    seen.add(r.pub.id);
    out.push({
      n: out.length + 1, publicationId: r.pub.id, title: r.pub.title, offering: r.pub.offering,
      observationPeriod: r.pub.observationPeriod, confidence: r.pub.confidence, text: r.text, orgId: r.orgId,
    });
    if (out.length >= MAX_PASSAGES) break;
  }
  return out;
}
