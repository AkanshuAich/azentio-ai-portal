import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  contributionEvents, contributionReports, contributions, moderationActions, organizations, reviewDrafts, sharedPublications,
} from "@/lib/db/schema";
import { requirePermission, type AuditSink } from "@/lib/authz/guard";
import type { Principal } from "@/lib/authz/types";
import {
  NotFoundError, applyTransition, bumpEpoch, knownClientNames, refuse, tellAuthor, type Contribution,
} from "./core";
import { currentConsents } from "./contributions";
import { deindexPublications, indexPublication } from "./indexing";
import { moderatorMayRead } from "./lifecycle";
import { scanText } from "./scanner";
import { publicReasonSchema, reviewDraftSchema } from "./validation";
import { withdrawContribution } from "./withdrawal";

const MOD = { audience: "shared_community" } as const;

async function requireModerator(principal: Principal, audit: AuditSink, subjectType: string, subjectId?: string) {
  await requirePermission({ principal, audit, subjectType, subjectId }, "moderate", MOD);
}

/**
 * A moderator may read only what was SUBMITTED for review. Drafts, and anything the author kept private or
 * limited to their organisation, are out of reach: the moderation grant is not access to client drafts.
 */
async function loadForReview(db: Db, id: string): Promise<Contribution> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError();
  const [c] = await db.select().from(contributions).where(eq(contributions.id, id));
  // Withdrawn and rejected items are closed: the author took them back or review has finished.
  const reviewable = ["submitted", "in_review", "returned", "approved", "published", "unpublished_under_review"];
  if (!c || !moderatorMayRead(c.status) || !reviewable.includes(c.status) || c.sharingChoice !== "propose_shared") throw new NotFoundError();
  return c;
}

// ---------------------------------------------------------------- queue and review

export async function listQueue(db: Db, principal: Principal, audit: AuditSink) {
  await requireModerator(principal, audit, "moderation_queue");
  const rows = await db
    .select({ c: contributions, org: organizations.name })
    .from(contributions)
    .innerJoin(organizations, eq(organizations.id, contributions.orgId))
    .where(and(eq(contributions.sharingChoice, "propose_shared"), inArray(contributions.status, ["submitted", "in_review", "returned", "unpublished_under_review"])))
    .orderBy(asc(contributions.submittedAt));
  return rows.map((r) => ({
    id: r.c.id, title: r.c.title, offering: r.c.offering, status: r.c.status, version: r.c.version, org: r.org,
    flags: r.c.sensitiveFlags, submittedAt: r.c.submittedAt,
  }));
}

/** Opening a source for review is itself an audited act. */
export async function openReview(db: Db, principal: Principal, audit: AuditSink, id: string) {
  await requireModerator(principal, audit, "contribution_review", id);
  const c = await loadForReview(db, id);
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, c.orgId));
  await audit({ actorId: principal.userId, action: "moderate", subjectType: "contribution_review_read", subjectId: id, orgId: c.orgId, allowed: true, reason: "private source opened for review" });

  const names = await knownClientNames(db);
  const [draft] = await db.select().from(reviewDrafts).where(eq(reviewDrafts.contributionId, id));
  const events = await db.select().from(contributionEvents).where(eq(contributionEvents.contributionId, id)).orderBy(desc(contributionEvents.at));
  const actions = await db.select().from(moderationActions).where(eq(moderationActions.contributionId, id)).orderBy(desc(moderationActions.at));
  const consentsNow = await currentConsents(db, id);

  return {
    id: c.id, status: c.status, version: c.version, org: org?.name ?? "",
    source: {
      kind: c.kind, title: c.title, body: c.body, offering: c.offering, industry: c.industry, region: c.region,
      observationPeriod: c.observationPeriod, evidenceType: c.evidenceType, confidence: c.confidence,
    },
    // Live scan of the source so the reviewer sees exactly what to remove. Matches are shown here only.
    sourceFlags: scanText([c.title, c.body, c.industry, c.region, c.observationPeriod].filter(Boolean).join("\n"), { knownNames: names }),
    reviewDraft: draft ?? null,
    reviewFlags: draft ? scanText([draft.title, draft.body, draft.industry, draft.region, draft.observationPeriod].filter(Boolean).join("\n"), { knownNames: names }) : [],
    consents: { publish_shared: consentsNow.publish_shared, attribution: consentsNow.attribution },
    timeline: events.map((e) => ({ at: e.at, actor: e.actorType, from: e.fromStatus, to: e.toStatus, note: e.note })),
    actions: actions.map((a) => ({ at: a.at, action: a.action, publicReason: a.publicReason, privateNotes: a.privateNotes })),
  };
}

async function record(db: Db, c: Contribution, moderatorId: string, action: string, toStatus: string, publicReason: string | null, privateNotes?: string | null) {
  await db.insert(moderationActions).values({ contributionId: c.id, moderatorId, action, toStatus, publicReason, privateNotes: privateNotes ?? null });
}

export async function startReview(db: Db, principal: Principal, audit: AuditSink, id: string) {
  await requireModerator(principal, audit, "contribution_review", id);
  const c = await loadForReview(db, id);
  let after!: () => Promise<void>;
  await db.transaction(async (tx) => { after = await applyTransition({ q: tx, audit, actorId: principal.userId, actor: "moderator" }, c, "in_review", "A moderator has started reviewing this"); });
  await after();
  await record(db, c, principal.userId, "start_review", "in_review", null);
}

/** Saves the reviewed copy. It holds reviewed fields only and is the sole source for the shared version. */
export async function saveReviewDraft(db: Db, principal: Principal, audit: AuditSink, id: string, raw: unknown, privateNotes?: string) {
  await requireModerator(principal, audit, "contribution_review", id);
  const c = await loadForReview(db, id);
  if (c.status !== "in_review") throw refuse("start the review before editing the shared copy");
  const input = reviewDraftSchema.parse(raw);

  // Attribution is opt-in by the author. The moderator can approve it but never add it on their own.
  if (input.attribution === "organisation" && !(await currentConsents(db, id)).attribution) throw refuse("the author has not agreed to be named");

  const values = {
    title: input.title, body: input.body, offering: input.offering, industry: input.industry ?? null, region: input.region ?? null,
    observationPeriod: input.observationPeriod ?? null, evidenceType: input.evidenceType ?? null, confidence: input.confidence ?? null,
    attribution: input.attribution, evidenceQuality: input.evidenceQuality ?? null, topic: input.topic ?? c.kind, updatedBy: principal.userId, updatedAt: new Date(),
  };
  await db.insert(reviewDrafts).values({ contributionId: id, ...values }).onConflictDoUpdate({ target: reviewDrafts.contributionId, set: values });
  await record(db, c, principal.userId, "redact", "in_review", null, privateNotes);

  const names = await knownClientNames(db);
  return { flags: scanText([input.title, input.body, input.industry, input.region, input.observationPeriod].filter(Boolean).join("\n"), { knownNames: names }) };
}

export async function requestClarification(db: Db, principal: Principal, audit: AuditSink, id: string, raw: unknown, privateNotes?: string) {
  await requireModerator(principal, audit, "contribution_review", id);
  const { reason } = publicReasonSchema.parse(raw);
  const c = await loadForReview(db, id);
  let after!: () => Promise<void>;
  await db.transaction(async (tx) => { after = await applyTransition({ q: tx, audit, actorId: principal.userId, actor: "moderator" }, c, "returned", reason); });
  await after();
  await record(db, c, principal.userId, "request_clarification", "returned", reason, privateNotes);
  await tellAuthor(db, c, `Returned to you: ${reason}`);
}

export async function rejectContribution(db: Db, principal: Principal, audit: AuditSink, id: string, raw: unknown, privateNotes?: string) {
  await requireModerator(principal, audit, "contribution_review", id);
  const { reason } = publicReasonSchema.parse(raw);
  const c = await loadForReview(db, id);
  let after!: () => Promise<void>;
  await db.transaction(async (tx) => { after = await applyTransition({ q: tx, audit, actorId: principal.userId, actor: "moderator" }, c, "rejected", reason); });
  await after();
  await record(db, c, principal.userId, "reject", "rejected", reason, privateNotes);
  await tellAuthor(db, c, `Not accepted for sharing: ${reason}`);
}

// ---------------------------------------------------------------- publish

/**
 * Publishes the REVIEWED copy as a new shared version. It reads from the review draft only, so nothing
 * from the private source's hidden metadata can reach it. A newer version replaces the previous live one;
 * the replacement is atomic with indexing, so an item is never half-published or double-listed.
 */
export async function publishReviewed(db: Db, principal: Principal, audit: AuditSink, id: string, opts: { confirmReviewedCopyIsSafe?: boolean } = {}) {
  await requireModerator(principal, audit, "contribution_review", id);
  const c = await loadForReview(db, id);
  if (c.status !== "in_review") throw refuse("only an item in review can be published");

  const [draft] = await db.select().from(reviewDrafts).where(eq(reviewDrafts.contributionId, id));
  if (!draft) throw refuse("prepare the reviewed copy before publishing");
  const k = await currentConsents(db, id);
  if (!k.publish_shared) throw refuse("the author has not given permission to publish");
  if (draft.attribution === "organisation" && !k.attribution) throw refuse("the author has not agreed to be named");

  // Likely-sensitive content in the reviewed copy blocks publication unless the reviewer explicitly confirms.
  const flags = scanText([draft.title, draft.body, draft.industry, draft.region, draft.observationPeriod].filter(Boolean).join("\n"), { knownNames: await knownClientNames(db) });
  if (flags.length > 0 && !opts.confirmReviewedCopyIsSafe) throw refuse(`the reviewed copy still contains likely-sensitive content (${[...new Set(flags.map((f) => f.kind))].join(", ")}); remove it or confirm it is safe`);

  let afterApprove!: () => Promise<void>;
  let afterPublish!: () => Promise<void>;
  let publicationId!: string;
  await db.transaction(async (tx) => {
    const approved = { q: tx, audit, actorId: principal.userId, actor: "moderator" as const };
    afterApprove = await applyTransition(approved, c, "approved", "Approved by a moderator");
    afterPublish = await applyTransition(approved, { ...c, status: "approved" }, "published", "Shared with the learning community");

    // Retire the previous live version, and everything derived from it.
    const prior = await tx.select({ id: sharedPublications.id }).from(sharedPublications).where(and(eq(sharedPublications.contributionId, id), isNull(sharedPublications.withdrawnAt), isNull(sharedPublications.supersededAt)));
    if (prior.length) {
      await tx.update(sharedPublications).set({ supersededAt: new Date() }).where(inArray(sharedPublications.id, prior.map((p) => p.id)));
      await deindexPublications(tx, prior.map((p) => p.id));
    }

    const [pub] = await tx.insert(sharedPublications).values({
      contributionId: id, version: c.version, title: draft.title, body: draft.body, offering: draft.offering, industry: draft.industry,
      region: draft.region, observationPeriod: draft.observationPeriod, evidenceType: draft.evidenceType, confidence: draft.confidence,
      attribution: draft.attribution === "organisation" ? "organisation" : "anonymous", evidenceQuality: draft.evidenceQuality, topic: draft.topic,
    }).returning();
    await indexPublication(tx, pub);
    await bumpEpoch(tx);
    publicationId = pub.id;
  });
  await afterApprove();
  await afterPublish();
  await record(db, c, principal.userId, "publish", "published", "Approved shared version.");
  await tellAuthor(db, c, "Your contribution was approved and shared as a de-identified version");
  return { publicationId };
}

// ---------------------------------------------------------------- unpublish, restore, reports

/** Pauses a published item while it is reviewed: removed from search and AIRA at once, restorable. */
export async function unpublish(db: Db, principal: Principal, audit: AuditSink, contributionId: string, raw: unknown, privateNotes?: string) {
  await requireModerator(principal, audit, "contribution_review", contributionId);
  const { reason } = publicReasonSchema.parse(raw);
  const c = await loadForReview(db, contributionId);
  let after!: () => Promise<void>;
  await db.transaction(async (tx) => {
    after = await applyTransition({ q: tx, audit, actorId: principal.userId, actor: "moderator" }, c, "unpublished_under_review", reason);
    const live = await tx.select({ id: sharedPublications.id }).from(sharedPublications).where(and(eq(sharedPublications.contributionId, contributionId), isNull(sharedPublications.withdrawnAt), isNull(sharedPublications.supersededAt)));
    await deindexPublications(tx, live.map((p) => p.id));
    await bumpEpoch(tx);
  });
  await after();
  await record(db, c, principal.userId, "unpublish", "unpublished_under_review", reason, privateNotes);
  await tellAuthor(db, c, `Temporarily paused while it is reviewed: ${reason}`);
}

export async function restore(db: Db, principal: Principal, audit: AuditSink, contributionId: string, raw: unknown) {
  await requireModerator(principal, audit, "contribution_review", contributionId);
  const { reason } = publicReasonSchema.parse(raw);
  const c = await loadForReview(db, contributionId);
  let after!: () => Promise<void>;
  await db.transaction(async (tx) => {
    after = await applyTransition({ q: tx, audit, actorId: principal.userId, actor: "moderator" }, c, "published", reason);
    const live = await tx.select().from(sharedPublications).where(and(eq(sharedPublications.contributionId, contributionId), isNull(sharedPublications.withdrawnAt), isNull(sharedPublications.supersededAt)));
    for (const p of live) await indexPublication(tx, p);
    await bumpEpoch(tx);
  });
  await after();
  await record(db, c, principal.userId, "restore", "published", reason);
  await tellAuthor(db, c, `The review is complete and it is shared again: ${reason}`);
}

/** The moderator withdraws content found to be unsafe. The contributor is told; the reporter is never named. */
export async function withdrawByModerator(db: Db, principal: Principal, audit: AuditSink, contributionId: string, raw: unknown) {
  await requireModerator(principal, audit, "contribution_review", contributionId);
  const { reason } = publicReasonSchema.parse(raw);
  const c = await loadForReview(db, contributionId);
  const result = await withdrawContribution(db, c, "moderator", principal.userId, audit, reason);
  await record(db, c, principal.userId, "withdraw", "withdrawn", reason);
  return result;
}

export async function listOpenReports(db: Db, principal: Principal, audit: AuditSink) {
  await requireModerator(principal, audit, "contribution_report");
  const rows = await db
    .select({ r: contributionReports, p: sharedPublications, c: contributions })
    .from(contributionReports)
    .innerJoin(sharedPublications, eq(sharedPublications.id, contributionReports.publicationId))
    .innerJoin(contributions, eq(contributions.id, sharedPublications.contributionId))
    .where(eq(contributionReports.status, "open"))
    .orderBy(desc(contributionReports.at));
  // The reporter's identity and organisation are deliberately not selected.
  return rows.map((x) => ({ reportId: x.r.id, reason: x.r.reason, reportedAt: x.r.at, contributionId: x.c.id, status: x.c.status, publicationId: x.p.id, title: x.p.title, body: x.p.body }));
}

export async function dismissReport(db: Db, principal: Principal, audit: AuditSink, reportId: string, raw: unknown) {
  await requireModerator(principal, audit, "contribution_report", reportId);
  const { reason } = publicReasonSchema.parse(raw);
  const done = await db.update(contributionReports).set({ status: "resolved", resolution: reason, resolvedBy: principal.userId, resolvedAt: new Date() }).where(and(eq(contributionReports.id, reportId), eq(contributionReports.status, "open"))).returning({ id: contributionReports.id });
  if (done.length === 0) throw new NotFoundError();
  await audit({ actorId: principal.userId, action: "moderate", subjectType: "contribution_report", subjectId: reportId, orgId: null, allowed: true, reason: "report dismissed", detail: { resolution: reason } });
}

/** Marks every open report on a contribution as resolved once a decision has been taken. */
export async function resolveReportsFor(db: Db, principal: Principal, contributionId: string, resolution: string) {
  const pubs = await db.select({ id: sharedPublications.id }).from(sharedPublications).where(eq(sharedPublications.contributionId, contributionId));
  if (pubs.length === 0) return;
  await db.update(contributionReports).set({ status: "resolved", resolution, resolvedBy: principal.userId, resolvedAt: new Date() })
    .where(and(inArray(contributionReports.publicationId, pubs.map((p) => p.id)), eq(contributionReports.status, "open")));
}
