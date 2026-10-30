import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { contributions, ideaEvidence, improvementIdeas, sharedPublications, users } from "@/lib/db/schema";
import { ForbiddenError, requirePermission, type AuditSink } from "@/lib/authz/guard";
import type { Principal } from "@/lib/authz/types";
import { NotFoundError, assertOfferingExists, knownClientNames } from "./core";
import { toSharedDTO } from "./dto";
import { LIVE } from "./feed";
import { scanText } from "./scanner";
import { notify } from "@/lib/notifications/inapp";

import { IDEA_LABEL, IDEA_STATUSES } from "./idea-constants";
export { IDEA_LABEL, IDEA_STATUSES };
const RES = { audience: "shared_community" } as const;

const ideaSchema = z.object({
  title: z.string().trim().min(4).max(140),
  problem: z.string().trim().min(10).max(2000),
  offering: z.string().trim().min(1).max(80),
  proposedOutcome: z.string().trim().max(1000).optional().transform((v) => v || undefined),
  ownerTeam: z.string().trim().min(2).max(100),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  themeId: z.string().uuid().optional(),
  evidence: z.array(z.string().uuid()).max(25).default([]),
});

async function requireManager(principal: Principal, audit: AuditSink, id?: string) {
  await requirePermission({ principal, audit, subjectType: "improvement_idea", subjectId: id }, "manage_ideas", RES);
}

/** Only evidence the caller could already see in the shared feed can be linked, and only live items. */
async function assertLiveEvidence(db: Db, ids: string[]) {
  if (ids.length === 0) return;
  const ok = await db.select({ id: sharedPublications.id }).from(sharedPublications).innerJoin(contributions, eq(contributions.id, sharedPublications.contributionId)).where(and(inArray(sharedPublications.id, ids), LIVE));
  if (ok.length !== new Set(ids).size) throw new NotFoundError();
}

export async function createIdea(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requireManager(principal, audit);
  const input = ideaSchema.parse(raw);
  await assertOfferingExists(db, input.offering);
  await assertLiveEvidence(db, input.evidence);

  const [idea] = await db.insert(improvementIdeas).values({
    title: input.title, problem: input.problem, offering: input.offering, proposedOutcome: input.proposedOutcome ?? null, ownerTeam: input.ownerTeam,
    priority: input.priority, status: "proposed", themeId: input.themeId ?? null, ownerUserId: principal.userId,
    // Nothing is client-visible until the owner publishes an approved summary.
    clientVisible: false,
  }).returning();
  if (input.evidence.length) await db.insert(ideaEvidence).values(input.evidence.map((publicationId) => ({ ideaId: idea.id, publicationId })));
  await audit({ actorId: principal.userId, action: "manage_ideas", subjectType: "improvement_idea", subjectId: idea.id, orgId: null, allowed: true, reason: "idea created", detail: { to: "proposed" } });
  return idea.id;
}

async function loadOwned(db: Db, principal: Principal, audit: AuditSink, id: string) {
  await requireManager(principal, audit, id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError();
  const [i] = await db.select().from(improvementIdeas).where(eq(improvementIdeas.id, id));
  if (!i) throw new NotFoundError();
  // Product owners work on ideas assigned to them; a platform administrator can step in.
  if (i.ownerUserId !== principal.userId && !principal.permissions.has("platform.administer")) {
    await audit({ actorId: principal.userId, action: "manage_ideas", subjectType: "improvement_idea", subjectId: id, orgId: null, allowed: false, reason: "not the assigned owner" });
    throw new ForbiddenError({ allow: false, reason: "this idea is assigned to someone else" });
  }
  return i;
}

export async function linkIdeaEvidence(db: Db, principal: Principal, audit: AuditSink, ideaId: string, publicationId: string) {
  await loadOwned(db, principal, audit, ideaId);
  await assertLiveEvidence(db, [publicationId]);
  await db.insert(ideaEvidence).values({ ideaId, publicationId }).onConflictDoNothing();
  await db.update(improvementIdeas).set({ updatedAt: sql`now()` }).where(eq(improvementIdeas.id, ideaId));
}

export async function unlinkIdeaEvidence(db: Db, principal: Principal, audit: AuditSink, ideaId: string, publicationId: string) {
  await loadOwned(db, principal, audit, ideaId);
  await db.delete(ideaEvidence).where(and(eq(ideaEvidence.ideaId, ideaId), eq(ideaEvidence.publicationId, publicationId)));
}

/** Changes status. Every change is audited with its from/to, and the last-update time moves. */
export async function updateIdeaStatus(db: Db, principal: Principal, audit: AuditSink, id: string, status: unknown) {
  const next = z.enum(IDEA_STATUSES).parse(status);
  const idea = await loadOwned(db, principal, audit, id);
  if (idea.status === next) return;
  await db.update(improvementIdeas).set({ status: next, updatedAt: sql`now()` }).where(eq(improvementIdeas.id, id));
  await audit({ actorId: principal.userId, action: "manage_ideas", subjectType: "improvement_idea", subjectId: id, orgId: null, allowed: true, reason: `status ${idea.status} -> ${next}`, detail: { from: idea.status, to: next } });
}

const updateSchema = z.object({ summary: z.string().trim().min(10, "Write a short plain-language update").max(500) });

/**
 * Closes the loop with clients: publishes an approved, plain-language summary and tells the contributors
 * whose evidence supports the idea. The summary is scanned so it can't name a client or carry contact
 * details, and the notification carries only the idea's title and status, never source material, internal
 * discussion, or anyone else's case. A status other than Released is always framed as not a commitment.
 */
export async function publishClientUpdate(db: Db, principal: Principal, audit: AuditSink, id: string, raw: unknown) {
  const { summary } = updateSchema.parse(raw);
  const idea = await loadOwned(db, principal, audit, id);

  const flags = scanText(summary, { knownNames: await knownClientNames(db) });
  if (flags.length > 0) throw new ForbiddenError({ allow: false, reason: `the update contains likely-sensitive content (${[...new Set(flags.map((f) => f.kind))].join(", ")})` });

  await db.update(improvementIdeas).set({ clientSummary: summary, clientVisible: true, updatedAt: sql`now()` }).where(eq(improvementIdeas.id, id));

  const authors = await db
    .selectDistinct({ userId: contributions.authorId })
    .from(ideaEvidence)
    .innerJoin(sharedPublications, eq(sharedPublications.id, ideaEvidence.publicationId))
    .innerJoin(contributions, eq(contributions.id, sharedPublications.contributionId))
    .where(eq(ideaEvidence.ideaId, id));
  const label = IDEA_LABEL[idea.status as (typeof IDEA_STATUSES)[number]] ?? idea.status;
  for (const a of authors) await notify(db, a.userId, `An improvement idea your contribution supports is now "${label}": ${idea.title}. This is a status update, not a commitment to deliver.`, "/workspace/dashboard");

  await audit({ actorId: principal.userId, action: "manage_ideas", subjectType: "improvement_idea", subjectId: id, orgId: null, allowed: true, reason: "client update published", detail: { notified: authors.length } });
  return { notified: authors.length };
}

export async function listIdeas(db: Db, principal: Principal, audit: AuditSink) {
  await requireManager(principal, audit);
  const rows = await db.select({ i: improvementIdeas, owner: users.displayName }).from(improvementIdeas).leftJoin(users, eq(users.id, improvementIdeas.ownerUserId)).orderBy(desc(improvementIdeas.updatedAt));
  return rows.map((r) => ({ ...r.i, ownerName: r.owner, mine: r.i.ownerUserId === principal.userId }));
}

/** The idea with its supporting evidence. Withdrawn or paused items drop out of the evidence automatically. */
export async function getIdea(db: Db, principal: Principal, audit: AuditSink, id: string) {
  await requireManager(principal, audit, id);
  const [i] = await db.select().from(improvementIdeas).where(eq(improvementIdeas.id, id));
  if (!i) throw new NotFoundError();
  const rows = await db
    .select({ pub: sharedPublications })
    .from(ideaEvidence)
    .innerJoin(sharedPublications, eq(sharedPublications.id, ideaEvidence.publicationId))
    .innerJoin(contributions, eq(contributions.id, sharedPublications.contributionId))
    .where(and(eq(ideaEvidence.ideaId, id), LIVE));
  // Attribution is decided by the publication itself, so no contributor is named here.
  return { idea: i, evidence: rows.map((r) => toSharedDTO(r.pub, null)), mine: i.ownerUserId === principal.userId };
}
