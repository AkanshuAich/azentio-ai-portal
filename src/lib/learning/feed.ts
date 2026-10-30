import { and, asc, desc, eq, ilike, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import {
  contributionReports, contributions, organizations, publicationFeedback, savedSearches, searchDocuments, sharedPublications,
} from "@/lib/db/schema";
import { requirePermission, type AuditSink } from "@/lib/authz/guard";
import { can } from "@/lib/authz/policy";
import type { Principal } from "@/lib/authz/types";
import { bucketCount } from "@/lib/insights/safeguards";
import { NotFoundError, refuse } from "./core";
import { toSharedDTO, type SharedPublicationDTO } from "./dto";

const SHARED = { audience: "shared_community" } as const;

/** The shared feed is for authorised participants only: employees and members of a valid client workspace. */
export async function requireParticipant(principal: Principal, audit: AuditSink, subjectType = "shared_feed") {
  await requirePermission({ principal, audit, subjectType }, "read", SHARED);
}

export function isParticipant(principal: Principal): boolean {
  return can(principal, "read", SHARED).allow;
}

/**
 * The one definition of "visible in the shared feed": a live, reviewed version that is not withdrawn,
 * superseded or paused. Search, counts, suggestions, exports, themes and AIRA all use it, so they cannot
 * disagree about what is visible.
 */
export const LIVE = and(
  isNull(sharedPublications.withdrawnAt),
  isNull(sharedPublications.supersededAt),
  notInArray(contributions.status, ["unpublished_under_review", "withdrawn", "rejected"]),
);

export const searchParams = z.object({
  q: z.string().trim().max(200).optional().transform((v) => v || undefined),
  offering: z.string().trim().max(80).optional().transform((v) => v || undefined),
  industry: z.string().trim().max(80).optional().transform((v) => v || undefined),
  region: z.string().trim().max(80).optional().transform((v) => v || undefined),
  period: z.string().trim().max(40).optional().transform((v) => v || undefined),
  topic: z.string().trim().max(60).optional().transform((v) => v || undefined),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type SearchParams = z.infer<typeof searchParams>;

interface Row { pub: typeof sharedPublications.$inferSelect; orgId: string; orgName: string }

async function visibleRows(db: Db, p: SearchParams): Promise<Row[]> {
  const where: SQL[] = [LIVE!];
  if (p.offering) where.push(eq(sharedPublications.offering, p.offering));
  if (p.industry) where.push(eq(sharedPublications.industry, p.industry));
  if (p.region) where.push(eq(sharedPublications.region, p.region));
  if (p.topic) where.push(eq(sharedPublications.topic, p.topic));
  if (p.period) where.push(ilike(sharedPublications.observationPeriod, `${p.period.replace(/[%_]/g, "")}%`));

  if (p.q) {
    // Text search goes through the search INDEX. An item whose index entries were removed (withdrawn or
    // paused) cannot be found, even before the visibility filter above is applied.
    const rows = await db
      .select({ pub: sharedPublications, orgId: contributions.orgId, orgName: organizations.name, rank: sql<number>`ts_rank(to_tsvector('simple', ${searchDocuments.text}), websearch_to_tsquery('simple', ${p.q}))` })
      .from(searchDocuments)
      .innerJoin(sharedPublications, eq(sharedPublications.id, searchDocuments.publicationId))
      .innerJoin(contributions, eq(contributions.id, sharedPublications.contributionId))
      .innerJoin(organizations, eq(organizations.id, contributions.orgId))
      .where(and(...where, sql`to_tsvector('simple', ${searchDocuments.text}) @@ websearch_to_tsquery('simple', ${p.q})`))
      .orderBy(desc(sql`ts_rank(to_tsvector('simple', ${searchDocuments.text}), websearch_to_tsquery('simple', ${p.q}))`), desc(sharedPublications.publishedAt));
    return rows.map(({ pub, orgId, orgName }) => ({ pub, orgId, orgName }));
  }

  return db
    .select({ pub: sharedPublications, orgId: contributions.orgId, orgName: organizations.name })
    .from(sharedPublications)
    .innerJoin(contributions, eq(contributions.id, sharedPublications.contributionId))
    .innerJoin(organizations, eq(organizations.id, contributions.orgId))
    .where(and(...where))
    .orderBy(desc(sharedPublications.publishedAt));
}

const dto = (r: Row): SharedPublicationDTO => toSharedDTO(r.pub, r.orgName);

export interface FacetBucket { value: string; /** Null when too few organisations stand behind the bucket. */ count: number | null }

function facet(rows: Row[], pick: (p: typeof sharedPublications.$inferSelect) => string | null): FacetBucket[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) { const v = pick(r.pub); if (v) groups.set(v, [...(groups.get(v) ?? []), r]); }
  return [...groups.entries()]
    .map(([value, rs]) => ({ value, count: bucketCount(rs.length, rs.map((r) => r.orgId)) }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

export async function searchFeed(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requireParticipant(principal, audit);
  const p = searchParams.parse(raw ?? {});
  const rows = await visibleRows(db, p);
  return {
    total: rows.length,
    items: rows.slice(p.offset, p.offset + p.limit).map(dto),
    // Facet counts use the same visible rows, and a bucket's count is withheld below the cohort minimum.
    facets: {
      offering: facet(rows, (x) => x.offering), industry: facet(rows, (x) => x.industry), region: facet(rows, (x) => x.region),
      period: facet(rows, (x) => x.observationPeriod), topic: facet(rows, (x) => x.topic),
    },
  };
}

/** Typeahead suggestions drawn only from items the caller may see. */
export async function suggest(db: Db, principal: Principal, audit: AuditSink, prefix: string) {
  await requireParticipant(principal, audit);
  const q = prefix.trim().toLowerCase();
  if (q.length < 2) return [];
  const rows = await visibleRows(db, searchParams.parse({}));
  const pool = new Set<string>();
  for (const r of rows) for (const t of [r.pub.title, r.pub.offering, r.pub.industry, r.pub.region, r.pub.observationPeriod]) if (t) pool.add(t);
  return [...pool].filter((t) => t.toLowerCase().includes(q)).sort().slice(0, 8);
}

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  // Stop spreadsheet formula injection from reviewed text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/** CSV of the same reviewed fields the feed shows, for the same filters. No identifiers, no source data. */
export async function exportCsv(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requireParticipant(principal, audit, "shared_feed_export");
  const p = searchParams.parse({ ...(raw as object), limit: 100, offset: 0 });
  const rows = await visibleRows(db, p);
  await audit({ actorId: principal.userId, action: "read", subjectType: "shared_feed_export", subjectId: null, orgId: principal.activeOrgId, allowed: true, reason: "export", detail: { rows: rows.length } });
  const cols = ["title", "offering", "topic", "industry", "region", "observationPeriod", "evidenceType", "confidence", "evidenceQuality", "contributor", "publishedAt", "body"] as const;
  const lines = [cols.join(",")];
  for (const r of rows.slice(0, 500)) { const d = dto(r); lines.push(cols.map((c) => csvCell(d[c])).join(",")); }
  return lines.join("\r\n");
}

// ---------------------------------------------------------------- one item, feedback, reports

async function loadVisible(db: Db, principal: Principal, audit: AuditSink, id: string): Promise<Row> {
  await requireParticipant(principal, audit);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError();
  const [r] = await db
    .select({ pub: sharedPublications, orgId: contributions.orgId, orgName: organizations.name })
    .from(sharedPublications)
    .innerJoin(contributions, eq(contributions.id, sharedPublications.contributionId))
    .innerJoin(organizations, eq(organizations.id, contributions.orgId))
    .where(and(eq(sharedPublications.id, id), LIVE));
  if (!r) throw new NotFoundError();
  return r;
}

export async function getPublication(db: Db, principal: Principal, audit: AuditSink, id: string) {
  const r = await loadVisible(db, principal, audit, id);
  const [mine] = await db.select({ v: publicationFeedback.value }).from(publicationFeedback).where(and(eq(publicationFeedback.publicationId, id), eq(publicationFeedback.userId, principal.userId)));
  return { item: dto(r), myFeedback: mine?.v ?? null };
}

export const feedbackValue = z.enum(["useful", "needs_evidence"]);

/** One vote per person, replaceable. Counts are never shown to clients and never used to rank anything. */
export async function giveFeedback(db: Db, principal: Principal, audit: AuditSink, id: string, value: unknown) {
  const v = feedbackValue.parse(value);
  await loadVisible(db, principal, audit, id);
  await db.insert(publicationFeedback).values({ publicationId: id, userId: principal.userId, value: v })
    .onConflictDoUpdate({ target: [publicationFeedback.publicationId, publicationFeedback.userId], set: { value: v } });
}

export const reportReason = z.object({ reason: z.string().trim().min(5, "Say briefly what is wrong").max(500) });

/**
 * Report an item as misleading, confidential or inappropriate. The reporter needs only to be able to read
 * it. Nothing here asks them to identify any other client, and their identity is not exposed to the author.
 */
export async function reportPublication(db: Db, principal: Principal, audit: AuditSink, id: string, raw: unknown) {
  const { reason } = reportReason.parse(raw);
  await loadVisible(db, principal, audit, id);
  const open = await db.select({ id: contributionReports.id }).from(contributionReports).where(and(eq(contributionReports.publicationId, id), eq(contributionReports.reporterId, principal.userId), eq(contributionReports.status, "open")));
  if (open.length > 0) return { duplicate: true };
  await db.insert(contributionReports).values({ publicationId: id, reporterId: principal.userId, reason });
  await audit({ actorId: principal.userId, action: "write", subjectType: "contribution_report", subjectId: id, orgId: principal.activeOrgId, allowed: true, reason: "reported" });
  return { duplicate: false };
}

/** Quality feedback totals: employees with a moderation or product role only. Never shown to clients. */
export async function feedbackSummary(db: Db, principal: Principal, audit: AuditSink, id: string) {
  const allowed = can(principal, "moderate", SHARED).allow || can(principal, "manage_ideas", SHARED).allow;
  if (!allowed) throw refuse("feedback totals are for moderators and product owners");
  void audit;
  const rows = await db.select({ value: publicationFeedback.value, n: sql<number>`count(*)::int` }).from(publicationFeedback).where(eq(publicationFeedback.publicationId, id)).groupBy(publicationFeedback.value);
  return { useful: rows.find((r) => r.value === "useful")?.n ?? 0, needsEvidence: rows.find((r) => r.value === "needs_evidence")?.n ?? 0 };
}

// ---------------------------------------------------------------- saved searches

export const savedSearchSchema = z.object({ name: z.string().trim().min(2).max(80), query: searchParams.partial().omit({ limit: true, offset: true }) });

export async function saveSearch(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requireParticipant(principal, audit, "saved_search");
  const input = savedSearchSchema.parse(raw);
  if (!principal.activeOrgId) throw refuse("choose a workspace first");
  const [row] = await db.insert(savedSearches).values({ userId: principal.userId, orgId: principal.activeOrgId, name: input.name, query: input.query }).returning({ id: savedSearches.id });
  return row.id;
}

export async function listSavedSearches(db: Db, principal: Principal) {
  if (!isParticipant(principal) || !principal.activeOrgId) return [];
  return db.select({ id: savedSearches.id, name: savedSearches.name, query: savedSearches.query }).from(savedSearches)
    .where(and(eq(savedSearches.userId, principal.userId), eq(savedSearches.orgId, principal.activeOrgId))).orderBy(asc(savedSearches.name));
}

export async function deleteSavedSearch(db: Db, principal: Principal, id: string) {
  if (!principal.activeOrgId) throw new NotFoundError();
  const gone = await db.delete(savedSearches).where(and(eq(savedSearches.id, id), eq(savedSearches.userId, principal.userId), eq(savedSearches.orgId, principal.activeOrgId))).returning({ id: savedSearches.id });
  if (gone.length === 0) throw new NotFoundError();
}
