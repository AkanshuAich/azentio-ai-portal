import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { contributions, organizations, sharedPublications, themeEvidence, themes } from "@/lib/db/schema";
import { requirePermission, type AuditSink } from "@/lib/authz/guard";
import type { Principal } from "@/lib/authz/types";
import { cohortStat } from "@/lib/insights/safeguards";
import { NotFoundError, bumpEpoch } from "./core";
import { cachedByEpoch } from "./cache";
import { toSharedDTO, type SharedPublicationDTO } from "./dto";
import { LIVE, requireParticipant } from "./feed";

/** Below this many contributing organisations the sample is flagged as small, even above the suppression minimum. */
const SMALL_SAMPLE_BELOW = 5;

export type ThemeView =
  | { id: string; title: string; summary: string; offering: string; updatedAt: string; suppressed: true; reason: string }
  | {
      id: string; title: string; summary: string; offering: string; updatedAt: string; suppressed: false;
      distinctOrganisations: number; observationPeriod: string | null; confidence: string; limitations: string[];
      latestUpdate: string; evidence: SharedPublicationDTO[];
    };

const CONF_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

/**
 * The theme dashboard. For each theme, evidence is the LIVE reviewed items linked to it. Strength is the
 * number of DISTINCT contributing organisations, so five posts from one organisation count as one. Below
 * the minimum the theme still appears, but its count, period and evidence links are withheld.
 * The result is identical for every participant, so it is cached per feed epoch; any publish or withdrawal
 * bumps the epoch and the cache cannot serve a stale view.
 */
async function computeThemes(db: Db): Promise<ThemeView[]> {
  const all = await db.select().from(themes).orderBy(desc(themes.updatedAt));
  const links = await db
    .select({ themeId: themeEvidence.themeId, pub: sharedPublications, orgId: contributions.orgId, orgName: organizations.name })
    .from(themeEvidence)
    .innerJoin(sharedPublications, eq(sharedPublications.id, themeEvidence.publicationId))
    .innerJoin(contributions, eq(contributions.id, sharedPublications.contributionId))
    .innerJoin(organizations, eq(organizations.id, contributions.orgId))
    .where(LIVE);

  return all.map((t): ThemeView => {
    const rows = links.filter((l) => l.themeId === t.id);
    const stat = cohortStat(rows.map((r) => r.orgId));
    const base = { id: t.id, title: t.title, summary: t.summary, offering: t.offering, updatedAt: t.updatedAt.toISOString() };
    if (stat.suppressed) return { ...base, suppressed: true, reason: stat.reason };

    const periods = rows.map((r) => r.pub.observationPeriod).filter((p): p is string => !!p).sort();
    const lowest = rows.map((r) => r.pub.confidence).filter((c): c is string => !!c).sort((a, b) => (CONF_RANK[a] ?? 0) - (CONF_RANK[b] ?? 0))[0];
    const limitations = [
      ...(t.limitations ? [t.limitations] : []),
      ...(stat.distinctOrgs < SMALL_SAMPLE_BELOW ? [`Small sample: ${stat.distinctOrgs} organisations. Treat this as an early signal, not market prevalence.`] : []),
      "How many people posted is not evidence of how common something is, and agreement here does not show cause.",
    ];
    const latest = [t.updatedAt, ...rows.map((r) => r.pub.publishedAt)].sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      ...base, suppressed: false, distinctOrganisations: stat.distinctOrgs,
      observationPeriod: periods.length ? (periods[0] === periods.at(-1) ? periods[0] : `${periods[0]} to ${periods.at(-1)}`) : null,
      confidence: lowest ?? "unspecified", limitations, latestUpdate: latest.toISOString(),
      evidence: rows.map((r) => toSharedDTO(r.pub, r.orgName)),
    };
  });
}

export async function listThemes(db: Db, principal: Principal, audit: AuditSink): Promise<ThemeView[]> {
  await requireParticipant(principal, audit, "theme_dashboard");
  return cachedByEpoch(db, "themes", () => computeThemes(db));
}

// ---------------------------------------------------------------- curation (moderators)

const themeSchema = z.object({
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(10).max(600),
  offering: z.string().trim().min(1).max(80),
  limitations: z.string().trim().max(400).optional().transform((v) => v || undefined),
});

const MOD = { audience: "shared_community" } as const;

export async function createTheme(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requirePermission({ principal, audit, subjectType: "theme" }, "moderate", MOD);
  const input = themeSchema.parse(raw);
  const [t] = await db.insert(themes).values({ ...input, limitations: input.limitations ?? null }).returning({ id: themes.id });
  await bumpEpoch(db);
  return t.id;
}

/** Links a LIVE reviewed item to a theme. A withdrawn or paused item cannot be linked. */
export async function linkThemeEvidence(db: Db, principal: Principal, audit: AuditSink, themeId: string, publicationId: string) {
  await requirePermission({ principal, audit, subjectType: "theme", subjectId: themeId }, "moderate", MOD);
  const [ok] = await db.select({ id: sharedPublications.id }).from(sharedPublications).innerJoin(contributions, eq(contributions.id, sharedPublications.contributionId)).where(and(eq(sharedPublications.id, publicationId), LIVE));
  const [t] = await db.select({ id: themes.id }).from(themes).where(eq(themes.id, themeId));
  if (!ok || !t) throw new NotFoundError();
  await db.insert(themeEvidence).values({ themeId, publicationId }).onConflictDoNothing();
  await db.update(themes).set({ updatedAt: new Date() }).where(eq(themes.id, themeId));
  await bumpEpoch(db);
}

export async function unlinkThemeEvidence(db: Db, principal: Principal, audit: AuditSink, themeId: string, publicationId: string) {
  await requirePermission({ principal, audit, subjectType: "theme", subjectId: themeId }, "moderate", MOD);
  await db.delete(themeEvidence).where(and(eq(themeEvidence.themeId, themeId), eq(themeEvidence.publicationId, publicationId)));
  await bumpEpoch(db);
}
