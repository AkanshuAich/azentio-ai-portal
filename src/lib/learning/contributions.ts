import { and, desc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { consents, contributionEvents, contributions, sharedPublications, users } from "@/lib/db/schema";
import type { AuditSink } from "@/lib/authz/guard";
import { can } from "@/lib/authz/policy";
import type { Principal } from "@/lib/authz/types";
import { clientTenantOf, requireClientTenant } from "@/lib/client/service";
import { withTenant } from "@/lib/db/tenant";
import {
  NotFoundError, applyTransition, assertOfferingExists, isAuthor, knownClientNames, notifyModerators, orgVisible, refuse, sourceResource, tellAuthor,
  type Contribution,
} from "./core";
import { STATUS_LABEL, authorCanEdit, type Status } from "./lifecycle";
import { flagKinds } from "./scanner";
import { CONSENT_KINDS, consentSchema, draftSchema, submitSchema, type ConsentInput } from "./validation";
import { withdrawContribution } from "./withdrawal";

type ConsentKind = (typeof CONSENT_KINDS)[number];

// ---------------------------------------------------------------- consent (append-only history)

/** The effective consent per kind: the latest row wins, and the full history is kept. */
export async function currentConsents(db: Db, contributionId: string): Promise<Record<ConsentKind, boolean>> {
  const rows = await db.select().from(consents).where(eq(consents.contributionId, contributionId)).orderBy(desc(consents.at));
  const out: Record<ConsentKind, boolean> = { store_process: false, publish_shared: false, attribution: false, model_training: false };
  const seen = new Set<string>();
  for (const r of rows) if (!seen.has(r.kind)) { seen.add(r.kind); out[r.kind as ConsentKind] = r.granted; }
  return out;
}

export async function consentHistory(db: Db, contributionId: string) {
  return db.select().from(consents).where(eq(consents.contributionId, contributionId)).orderBy(desc(consents.at));
}

// Rows are stamped by the DATABASE clock (the column default), never the app's. "Latest wins" must order every row
// by one clock; mixing app and database time could let an older consent outrank a newer one.
async function recordConsents(db: Db, contributionId: string, next: Partial<ConsentInput>) {
  const current = await currentConsents(db, contributionId);
  const rows = CONSENT_KINDS.filter((k) => next[k] !== undefined && next[k] !== current[k]).map((k) => ({ contributionId, kind: k, granted: next[k]! }));
  if (rows.length) await db.insert(consents).values(rows);
}

// ---------------------------------------------------------------- create and edit

async function loadMine(db: Db, principal: Principal, audit: AuditSink, id: string): Promise<Contribution> {
  const orgId = await requireClientTenant(principal, audit);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError();
  // Read through row-level security: even without the policy check below, Postgres would not return another tenant's row.
  const [c] = await withTenant(db, orgId, (q) => q.select().from(contributions).where(eq(contributions.id, id)));
  // Another tenant's record is indistinguishable from one that does not exist.
  if (!c || !can(principal, "read", sourceResource(c)).allow) throw new NotFoundError();
  return c;
}

const draftConsents = z.object({ store_process: z.literal(true, { message: "Storing and processing your draft is required to save it" }) }).partial({});

/**
 * Creates a PRIVATE draft. Saving never shares anything: the draft starts private, only the author can
 * see it, and any wider audience is an explicit, separate choice made by the author.
 */
export async function createDraft(db: Db, principal: Principal, audit: AuditSink, raw: unknown, rawConsents: unknown) {
  const orgId = await requireClientTenant(principal, audit);
  const input = draftSchema.parse(raw);
  draftConsents.parse(rawConsents ?? {});
  const wanted = consentSchema.partial().parse(rawConsents ?? {});
  await assertOfferingExists(db, input.offering);

  const names = await knownClientNames(db);
  const flags = flagKinds([input.title, input.body], { knownNames: names });
  const [c] = await db
    .insert(contributions)
    .values({
      orgId, authorId: principal.userId, kind: input.kind, title: input.title, body: input.body, offering: input.offering,
      industry: input.industry ?? null, region: input.region ?? null, observationPeriod: input.observationPeriod ?? null,
      evidenceType: input.evidenceType ?? null, confidence: input.confidence ?? null, sharingChoice: input.sharingChoice,
      status: "draft", sensitiveFlags: flags,
    })
    .returning();

  await recordConsents(db, c.id, { store_process: true, publish_shared: false, attribution: false, model_training: false, ...wanted });
  await db.insert(contributionEvents).values({ contributionId: c.id, actorType: "author", fromStatus: null, toStatus: "draft", note: "Draft created, private to you" });
  await audit({ actorId: principal.userId, action: "write", subjectType: "contribution", subjectId: c.id, orgId, allowed: true, reason: "draft created", detail: { to: "draft" } });
  return { id: c.id, sensitiveFlags: flags };
}

const fieldsOf = (c: Contribution) => ({
  kind: c.kind, title: c.title, body: c.body, offering: c.offering, industry: c.industry ?? undefined, region: c.region ?? undefined,
  observationPeriod: c.observationPeriod ?? undefined, evidenceType: c.evidenceType ?? undefined, confidence: c.confidence ?? undefined,
  sharingChoice: c.sharingChoice,
});

/**
 * Edits a contribution. Allowed while it is a draft or has been returned. Editing a PUBLISHED item is a
 * material edit: it creates a new version that goes back through review (the reviewed copy that is live
 * stays as it was until the new version is approved), and it can never widen the audience by itself.
 */
export async function updateContribution(db: Db, principal: Principal, audit: AuditSink, id: string, raw: unknown) {
  const c = await loadMine(db, principal, audit, id);
  if (!isAuthor(principal, c)) throw refuse("only the author can edit this contribution");

  const published = c.status === "published";
  if (!published && !authorCanEdit(c.status)) throw refuse("this contribution can't be edited while it is under review");

  const input = (published ? submitSchema : draftSchema).parse(raw);
  await assertOfferingExists(db, input.offering);
  const consentsNow = await currentConsents(db, c.id);
  const flags = flagKinds([input.title, input.body], { knownNames: await knownClientNames(db) });

  const patch = {
    kind: input.kind, title: input.title, body: input.body, offering: input.offering, industry: input.industry ?? null, region: input.region ?? null,
    observationPeriod: input.observationPeriod ?? null, evidenceType: input.evidenceType ?? null, confidence: input.confidence ?? null,
    sharingChoice: input.sharingChoice, sensitiveFlags: flags, updatedAt: new Date(),
    // Moving away from "within my organisation" stops sharing with colleagues at once.
    ...(input.sharingChoice !== "organisation" ? { orgSharedAt: null } : {}),
  };

  if (!published) {
    await db.update(contributions).set(patch).where(and(eq(contributions.id, id), eq(contributions.status, c.status)));
    return { id, status: c.status as Status, newVersion: false, sensitiveFlags: flags };
  }

  // Material edit of a published item: needs the publish permission to still stand, then renewed review.
  if (!consentsNow.publish_shared) throw refuse("permission to publish a shared version has been withdrawn");
  let after!: () => Promise<void>;
  await db.transaction(async (tx) => {
    after = await applyTransition({ q: tx, audit, actorId: principal.userId, actor: "author" }, c, "submitted", "Edited: sent for renewed review as a new version", {
      ...patch, version: c.version + 1, submittedAt: new Date(),
    });
  });
  await after();
  await tellAuthor(db, c, "Your edit was sent for renewed review. The reviewed version already shared stays as it was until the new one is approved");
  await notifyModerators(db, "An edit to a shared contribution is waiting for renewed review");
  return { id, status: "submitted" as Status, newVersion: true, sensitiveFlags: flags };
}

// ---------------------------------------------------------------- submit, withdraw, consents

/**
 * Submits for review. Requires every reviewer-facing field, permission to publish a reviewed version, and a
 * community-sharing choice. Flagged content is allowed through but marked for the moderator, and the
 * author is told. A scan is never a guarantee, so a person always reviews it.
 */
export async function submitContribution(db: Db, principal: Principal, audit: AuditSink, id: string) {
  const c = await loadMine(db, principal, audit, id);
  if (!isAuthor(principal, c)) throw refuse("only the author can submit this contribution");
  if (c.status !== "draft" && c.status !== "returned") throw refuse("only a draft or a returned contribution can be submitted");

  submitSchema.parse(fieldsOf(c));
  const consentsNow = await currentConsents(db, id);
  if (!consentsNow.store_process) throw refuse("permission to store and process this contribution is required");
  if (!consentsNow.publish_shared) throw refuse("permission to publish a reviewed, de-identified version is required to submit");

  const flags = flagKinds([c.title, c.body], { knownNames: await knownClientNames(db) });
  let after!: () => Promise<void>;
  await db.transaction(async (tx) => {
    after = await applyTransition({ q: tx, audit, actorId: principal.userId, actor: "author" }, c, "submitted", c.status === "returned" ? "Amended and resubmitted" : "Submitted for review", {
      sensitiveFlags: flags, submittedAt: new Date(),
    });
  });
  await after();
  await tellAuthor(db, c, "Submitted for review. You'll be told here when its status changes");
  await notifyModerators(db, c.status === "returned" ? "A returned contribution was amended and is waiting for review" : "A contribution was submitted and is waiting for review");
  return { id, status: "submitted" as Status, sensitiveFlags: flags };
}

/**
 * The author's deliberate act of making an item visible to colleagues. Choosing "within my organisation" in
 * the form and saving does NOT do this; it must be asked for explicitly, and it is audited.
 */
export async function shareWithOrganisation(db: Db, principal: Principal, audit: AuditSink, id: string, share: boolean) {
  const c = await loadMine(db, principal, audit, id);
  if (!isAuthor(principal, c)) throw refuse("only the author can change who sees this");
  if (share && c.sharingChoice !== "organisation") throw refuse('choose "within my organisation" for this contribution first');
  if (["withdrawn", "rejected"].includes(c.status)) throw refuse("this contribution is closed");
  await db.update(contributions).set({ orgSharedAt: share ? new Date() : null, updatedAt: new Date() }).where(eq(contributions.id, id));
  await db.insert(contributionEvents).values({ contributionId: id, actorType: "author", fromStatus: c.status, toStatus: c.status, note: share ? "Shared with your organisation" : "No longer shared with your organisation" });
  await audit({ actorId: principal.userId, action: "write", subjectType: "contribution_visibility", subjectId: id, orgId: c.orgId, allowed: true, reason: share ? "shared with organisation" : "unshared", detail: { share } });
}

export async function withdrawMine(db: Db, principal: Principal, audit: AuditSink, id: string) {
  const c = await loadMine(db, principal, audit, id);
  if (!isAuthor(principal, c)) throw refuse("only the author can withdraw this contribution");
  return withdrawContribution(db, c, "author", principal.userId, audit, "Withdrawn by you");
}

/**
 * Changes the author's permissions. Each change is appended to the consent history. Withdrawing the
 * permission to publish withdraws the shared version; withdrawing attribution anonymises it. Neither can
 * undo anything already viewed, copied, or (should it ever exist) trained on.
 */
export async function setConsents(db: Db, principal: Principal, audit: AuditSink, id: string, raw: unknown) {
  const c = await loadMine(db, principal, audit, id);
  if (!isAuthor(principal, c)) throw refuse("only the author can change these permissions");
  const next = consentSchema.partial().parse(raw);
  if (next.store_process === false) throw refuse("to stop us storing this, withdraw the contribution instead");

  const before = await currentConsents(db, id);
  await recordConsents(db, id, next);
  await audit({ actorId: principal.userId, action: "write", subjectType: "consent", subjectId: id, orgId: c.orgId, allowed: true, reason: "consent changed", detail: { before, change: next } });

  if (next.publish_shared === false && before.publish_shared && (c.status === "published" || c.status === "unpublished_under_review")) {
    return { withdrawn: await withdrawContribution(db, c, "author", principal.userId, audit, "Permission to publish was withdrawn") };
  }
  if (next.attribution === false && before.attribution) {
    await db.update(sharedPublications).set({ attribution: "anonymous" }).where(and(eq(sharedPublications.contributionId, id), isNull(sharedPublications.withdrawnAt)));
  }
  return { withdrawn: null };
}

// ---------------------------------------------------------------- reading

const summary = (c: Contribution, authorName?: string) => ({
  id: c.id, title: c.title, kind: c.kind, offering: c.offering, status: c.status as Status, statusLabel: STATUS_LABEL[c.status as Status],
  sharingChoice: c.sharingChoice, version: c.version, updatedAt: c.updatedAt, author: authorName ?? null,
});
export type ContributionSummary = ReturnType<typeof summary>;

/** "My observations": everything the caller wrote, in every state. */
export async function listMine(db: Db, principal: Principal): Promise<ContributionSummary[]> {
  const orgId = clientTenantOf(principal);
  if (!orgId) return [];
  const rows = await withTenant(db, orgId, (q) => q.select().from(contributions).where(and(eq(contributions.orgId, orgId), eq(contributions.authorId, principal.userId))).orderBy(desc(contributions.updatedAt)));
  return rows.map((r) => summary(r));
}

/**
 * "Our organisation's observations": colleagues' items that were shared with the organisation or proposed
 * for community sharing. Drafts and private items are never included, and neither is anything from another
 * tenant. This is private organisation knowledge and is kept apart from the cross-client feed.
 */
export async function listOrganisation(db: Db, principal: Principal): Promise<ContributionSummary[]> {
  const orgId = clientTenantOf(principal);
  if (!orgId) return [];
  const rows = await withTenant(db, orgId, (q) => q
    .select({ c: contributions, author: users.displayName })
    .from(contributions)
    .innerJoin(users, eq(users.id, contributions.authorId))
    .where(and(eq(contributions.orgId, orgId), or(isNotNull(contributions.orgSharedAt), and(ne(contributions.status, "draft"), eq(contributions.sharingChoice, "propose_shared")))))
    .orderBy(desc(contributions.updatedAt)));
  return rows.map((r) => summary(r.c, r.author));
}

export async function getContribution(db: Db, principal: Principal, audit: AuditSink, id: string) {
  const c = await loadMine(db, principal, audit, id);
  const author = isAuthor(principal, c);
  const consentsNow = author ? await currentConsents(db, id) : null;
  const events = await db.select().from(contributionEvents).where(eq(contributionEvents.contributionId, id)).orderBy(desc(contributionEvents.at));
  const pubs = await db.select().from(sharedPublications).where(eq(sharedPublications.contributionId, id)).orderBy(desc(sharedPublications.version));
  const live = pubs.find((p) => !p.withdrawnAt && !p.supersededAt) ?? null;

  return {
    ...summary(c),
    isAuthor: author,
    orgShared: c.orgSharedAt !== null,
    body: c.body, industry: c.industry, region: c.region, observationPeriod: c.observationPeriod, evidenceType: c.evidenceType,
    confidence: c.confidence, sensitiveFlags: author ? c.sensitiveFlags : [],
    consents: consentsNow,
    // Only the public note of each step. Reviewer notes live elsewhere and are never returned.
    timeline: events.map((e) => ({ at: e.at, actor: e.actorType, from: e.fromStatus, to: e.toStatus, note: e.note })),
    liveVersion: live ? { version: live.version, publishedAt: live.publishedAt, attribution: live.attribution, title: live.title } : null,
    canEdit: author && (authorCanEdit(c.status) || c.status === "published"),
    canSubmit: author && (c.status === "draft" || c.status === "returned"),
    canWithdraw: author && ["submitted", "in_review", "returned", "published", "unpublished_under_review"].includes(c.status),
    // Who can see each version, and how it may be used (§09).
    visibility: describeVisibility(c, live, consentsNow),
  };
}

export interface VisibilityRow { version: string; who: string; use: string }

function describeVisibility(c: Contribution, live: { attribution: string; version: number } | null, k: Record<ConsentKind, boolean> | null): VisibilityRow[] {
  const rows: VisibilityRow[] = [{
    version: "Your original",
    who: orgVisible(c) ? "You and members of your organisation" : "Only you",
    use: "Stays in your workspace. It is never shown to other organisations and never copied into the shared feed.",
  }];
  if (live) {
    rows.push({
      version: `Reviewed shared version (v${live.version})`,
      who: `Authorised members of the learning community. ${live.attribution === "organisation" ? "Your organisation is named." : "Your organisation is not named."}`,
      use: "Searchable in the shared feed, grouped into themes, and cited in AIRA summaries. Counted as one organisation, however many items you share.",
    });
  } else if (c.status === "submitted" || c.status === "in_review" || c.status === "approved") {
    rows.push({ version: "Reviewed shared version", who: "Nobody yet. A moderator is reviewing it.", use: "Nothing is shared until a moderator approves a de-identified version." });
  }
  rows.push({
    version: "Model training",
    who: "Not applicable",
    use: k?.model_training ? "You allowed use in a future, separately approved training programme. No model is trained on contributions today." : "Not used for training. No model is trained on contributions today.",
  });
  return rows;
}
