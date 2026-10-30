import type { Db } from "@/lib/db/client";
import { INSIGHTS, LAB, PRODUCT_DETAIL, SOLUTIONS, TECHNOLOGY, TRUST_PRINCIPLES } from "@/content/site";
import { listPublicProducts } from "@/lib/public/products";

export interface Citation {
  title: string;
  href: string;
}

export interface AiraAnswer {
  answer: string;
  citations: Citation[];
  /** What AIRA was allowed to read for this answer. */
  scope: "public";
  /** No generative model is involved in public answers: retrieval over published pages only. */
  mode: "retrieval";
}

interface Doc extends Citation {
  text: string;
}

/**
 * The public AIRA corpus is built ONLY from public sources: product rows that the policy engine lets an
 * anonymous visitor read, plus the static public pages. Employee, tenant and shared-community content has
 * no path into this module.
 */
async function publicCorpus(db: Db): Promise<Doc[]> {
  const products = await listPublicProducts(db);
  return [
    ...products.map((p) => ({
      title: p.name,
      href: `/products/${p.slug}`,
      text: [p.summary, ...(PRODUCT_DETAIL[p.slug]?.does ?? []), PRODUCT_DETAIL[p.slug]?.oversight ?? ""].join(" "),
    })),
    ...SOLUTIONS.map((s) => ({ title: s.title, href: "/solutions", text: s.text })),
    ...INSIGHTS.map((i) => ({ title: i.title, href: "/insights", text: i.text })),
    ...LAB.map((l) => ({ title: l.title, href: "/lab", text: l.text })),
    ...TECHNOLOGY.map((t) => ({ title: t.title, href: "/technology", text: t.text })),
    { title: "Trust principles", href: "/technology", text: TRUST_PRINCIPLES.join(" ") },
  ];
}

const STOP = new Set("a an and are as at be by can do does for from how i in is it of on or our so that the this to we what which who with you your about tell me".split(" "));

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

export const MAX_QUESTION_LENGTH = 300;

export async function answerPublicQuestion(db: Db, question: string): Promise<AiraAnswer> {
  const q = tokens(question.slice(0, MAX_QUESTION_LENGTH));
  const corpus = await publicCorpus(db);

  const scored = corpus
    .map((d) => {
      const title = new Set(tokens(d.title));
      const body = new Set(tokens(d.text));
      const score = q.reduce((s, w) => s + (title.has(w) ? 3 : 0) + (body.has(w) ? 1 : 0), 0);
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) {
    return {
      answer:
        "I can only answer from the public azentio.ai pages, and I couldn't find anything on that. " +
        "Try asking about a product, a solution area, or how we approach trust and governance. " +
        "For anything else, you can start a conversation with the team.",
      citations: [{ title: "Start a conversation", href: "/connect" }],
      scope: "public",
      mode: "retrieval",
    };
  }

  const first = (t: string) => t.split(/(?<=[.!?])\s+/)[0];
  return {
    answer: scored.map(({ d }) => `${d.title}: ${first(d.text)}`).join("\n"),
    citations: scored.map(({ d }) => ({ title: d.title, href: d.href })),
    scope: "public",
    mode: "retrieval",
  };
}
