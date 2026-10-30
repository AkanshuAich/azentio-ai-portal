import { z } from "zod";
import type { Db } from "@/lib/db/client";
import type { AuditSink } from "@/lib/authz/guard";
import type { Principal } from "@/lib/authz/types";
import { minDistinctOrgs } from "@/lib/insights/safeguards";
import { requireParticipant } from "@/lib/learning/feed";
import { defaultSummariser, type Summariser } from "./claude";
import { retrieve, type Passage } from "./retrieve";

export const questionSchema = z.string().trim().min(3, "Ask a question of at least 3 characters").max(500, "Keep the question under 500 characters");

export interface AiraCitation { n: number; id: string; title: string; offering: string; observationPeriod: string | null; confidence: string | null }

export interface AiraResult {
  answer: string;
  citations: AiraCitation[];
  /** claude: summarised by the model. retrieval: plain retrieval summary (no model). no_evidence: nothing approved matched. */
  mode: "claude" | "retrieval" | "no_evidence";
  model: string | null;
  caveats: string[];
}

const first = (t: string) => t.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");

/** Deterministic answer built straight from the retrieved, approved passages. No model is involved. */
export function retrievalSummary(passages: Passage[]): string {
  return [
    "Here is what the approved shared observations say:",
    ...passages.map((p) => `• ${first(p.text.replace(new RegExp(`^${p.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\s*`), ""))} [${p.n}]`),
  ].join("\n");
}

/** Removes any citation marker that doesn't point at a passage we actually supplied. */
export function sanitiseCitations(text: string, max: number): string {
  return text.replace(/\[(\d+)\]/g, (m, d) => (Number(d) >= 1 && Number(d) <= max ? m : ""));
}

/**
 * Signed-in AIRA. It is open to authorised participants (employees and members of a valid client workspace),
 * answers only from approved shared observations, always cites them, and states its limits. What it never
 * does: read private sources, drafts or employee-only content; infer prevalence or causation; or reveal who
 * contributed. If the model is unavailable, declines, or no key is configured, it falls back to a plain
 * retrieval summary and says so.
 */
export async function askAira(
  db: Db, principal: Principal, audit: AuditSink, rawQuestion: unknown, deps: { summarise?: Summariser | null } = {},
): Promise<AiraResult> {
  await requireParticipant(principal, audit, "aira");
  const question = questionSchema.parse(rawQuestion);
  const passages = await retrieve(db, question);

  const standing = [
    "This summarises a small set of approved, de-identified observations. It is not a measure of how common something is, and it does not show cause.",
  ];

  if (passages.length === 0) {
    await audit({ actorId: principal.userId, action: "read", subjectType: "aira_query", subjectId: null, orgId: principal.activeOrgId, allowed: true, reason: "no evidence", detail: { mode: "no_evidence", passages: 0 } });
    return {
      answer: "I couldn't find any approved shared observations that match that. I only answer from approved contributions, so I can't speculate.",
      citations: [], mode: "no_evidence", model: null, caveats: standing,
    };
  }

  // Evidence strength is judged by distinct organisations; below the minimum we say "limited", never a number.
  const limited = new Set(passages.map((p) => p.orgId)).size < minDistinctOrgs();
  const caveats = [...standing, ...(limited ? ["Limited evidence: only a few organisations have contributed on this, so treat it as an early signal."] : [])];

  const summarise = deps.summarise === undefined ? defaultSummariser() : deps.summarise;
  let text: string | null = null;
  let model: string | null = null;
  let mode: AiraResult["mode"] = "retrieval";

  if (summarise) {
    try {
      // Strip internal fields: the model gets the question and reviewed passage text, nothing else.
      const forModel = passages.map(({ orgId: _o, publicationId: _p, ...rest }) => { void _o; void _p; return rest; });
      const out = await summarise({ question, passages: forModel });
      text = sanitiseCitations(out.text, passages.length).trim();
      model = out.model;
      mode = "claude";
    } catch {
      caveats.push("AI summarisation wasn't available just now, so this is a plain retrieval summary instead.");
    }
  } else {
    caveats.push("No AI model is configured, so this is a plain retrieval summary.");
  }
  if (!text) text = retrievalSummary(passages);

  // Metadata only: the question and the passages are deliberately not written to the audit log.
  await audit({ actorId: principal.userId, action: "read", subjectType: "aira_query", subjectId: null, orgId: principal.activeOrgId, allowed: true, reason: "answered", detail: { mode, model, passages: passages.length } });

  return {
    answer: text, mode, model, caveats,
    citations: passages.map((p) => ({ n: p.n, id: p.publicationId, title: p.title, offering: p.offering, observationPeriod: p.observationPeriod, confidence: p.confidence })),
  };
}
