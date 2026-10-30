import { inArray } from "drizzle-orm";
import { airaChunks, searchDocuments, sharedPublications } from "@/lib/db/schema";
import type { Q } from "./core";

type Pub = typeof sharedPublications.$inferSelect;

/** Text for the search index. Built ONLY from the reviewed, shared copy: never from the private source. */
export function searchTextOf(p: Pick<Pub, "title" | "body" | "offering" | "industry" | "region" | "observationPeriod">): string {
  return [p.title, p.body, p.offering, p.industry, p.region, p.observationPeriod].filter(Boolean).join(" ");
}

/** Splits reviewed text into short passages for retrieval, each carrying its title for context. */
export function chunksOf(p: Pick<Pub, "title" | "body">, max = 700): string[] {
  const parts = p.body.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const part of parts) {
    if (cur && cur.length + part.length + 1 > max) { out.push(cur); cur = part; } else cur = cur ? `${cur} ${part}` : part;
  }
  if (cur) out.push(cur);
  return (out.length ? out : [p.body]).map((c) => `${p.title}. ${c}`);
}

export async function indexPublication(q: Q, p: Pub) {
  await q.insert(searchDocuments).values({ publicationId: p.id, text: searchTextOf(p) });
  await q.insert(airaChunks).values(chunksOf(p).map((text) => ({ publicationId: p.id, text })));
}

/** Removes every derived entry for these publications. Safe to call when there are none. */
export async function deindexPublications(q: Q, ids: string[]) {
  if (ids.length === 0) return { search: 0, chunks: 0 };
  const s = await q.delete(searchDocuments).where(inArray(searchDocuments.publicationId, ids)).returning({ id: searchDocuments.id });
  const c = await q.delete(airaChunks).where(inArray(airaChunks.publicationId, ids)).returning({ id: airaChunks.id });
  return { search: s.length, chunks: c.length };
}
