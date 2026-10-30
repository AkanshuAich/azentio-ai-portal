import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { bookmarks, commentReports, comments, supportRequests, users } from "@/lib/db/schema";
import { ForbiddenError, requirePermission, type AuditSink } from "@/lib/authz/guard";
import { can } from "@/lib/authz/policy";
import type { Principal } from "@/lib/authz/types";
import { NotFoundError } from "@/lib/employee/service";
import { RESOURCE_TYPES, loadResource, type ResourceType } from "@/lib/resources";
import { requireClientTenant, clientTenantOf } from "./service";

const refuse = (reason: string) => new ForbiddenError({ allow: false, reason });
const resourceType = z.enum(RESOURCE_TYPES);

// ---------------------------------------------------------------- bookmarks

/** Toggles a bookmark. Only a resource the caller can currently read may be bookmarked. */
export async function toggleBookmark(db: Db, principal: Principal, audit: AuditSink, rawType: unknown, resourceId: string) {
  const type = resourceType.parse(rawType);
  const orgId = await requireClientTenant(principal, audit);
  const res = await loadResource(db, type, resourceId);
  if (!res) throw new NotFoundError();
  await requirePermission({ principal, audit, subjectType: type, subjectId: resourceId }, "read", res.resource);

  const removed = await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.userId, principal.userId), eq(bookmarks.resourceType, type), eq(bookmarks.resourceId, resourceId)))
    .returning({ id: bookmarks.id });
  if (removed.length > 0) return { bookmarked: false };
  await db.insert(bookmarks).values({ userId: principal.userId, orgId, resourceType: type, resourceId });
  return { bookmarked: true };
}

/** Bookmarks made in THIS workspace, re-checked against current access so a revoked resource drops out. */
export async function listBookmarks(db: Db, principal: Principal) {
  const orgId = clientTenantOf(principal);
  if (!orgId) return [];
  const rows = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, principal.userId), eq(bookmarks.orgId, orgId)))
    .orderBy(desc(bookmarks.createdAt));

  const out: { id: string; type: ResourceType; resourceId: string; title: string; href: string }[] = [];
  for (const b of rows) {
    const res = await loadResource(db, b.resourceType as ResourceType, b.resourceId);
    if (res && can(principal, "read", res.resource).allow) out.push({ id: b.id, type: res.type, resourceId: res.id, title: res.title, href: res.href });
  }
  return out;
}

// ---------------------------------------------------------------- comments

export const commentSchema = z.object({
  parentType: resourceType,
  parentId: z.string().uuid(),
  body: z.string().trim().min(1, "Write something").max(2000),
});

/**
 * Comments inherit the parent's audience: you may comment only where you can read the parent, and only on
 * tenant-scoped or entitled parents. The comment lives in the author's active tenant, so another entitled
 * organisation never sees it.
 */
export async function addComment(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  const input = commentSchema.parse(raw);
  const orgId = await requireClientTenant(principal, audit);
  const parent = await loadResource(db, input.parentType, input.parentId);
  if (!parent) throw new NotFoundError();
  await requirePermission({ principal, audit, subjectType: input.parentType, subjectId: input.parentId }, "read", parent.resource);
  if (parent.audience !== "tenant" && parent.audience !== "entitled") throw refuse("comments are only available on organisation or entitled content");

  const [row] = await db
    .insert(comments)
    .values({ parentType: input.parentType, parentId: input.parentId, orgId, authorId: principal.userId, body: input.body })
    .returning({ id: comments.id });
  return row.id;
}

export async function listComments(db: Db, principal: Principal, audit: AuditSink, rawType: unknown, parentId: string) {
  const type = resourceType.parse(rawType);
  const orgId = await requireClientTenant(principal, audit);
  const parent = await loadResource(db, type, parentId);
  if (!parent) throw new NotFoundError();
  await requirePermission({ principal, audit, subjectType: type, subjectId: parentId }, "read", parent.resource);

  return db
    .select({ id: comments.id, body: comments.body, createdAt: comments.createdAt, author: users.displayName, authorId: comments.authorId })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(and(eq(comments.parentType, type), eq(comments.parentId, parentId), eq(comments.orgId, orgId), eq(comments.status, "visible")))
    .orderBy(asc(comments.createdAt));
}

async function readableComment(db: Db, principal: Principal, audit: AuditSink, commentId: string) {
  const orgId = await requireClientTenant(principal, audit);
  const [c] = await db.select().from(comments).where(and(eq(comments.id, commentId), eq(comments.orgId, orgId)));
  if (!c) throw new NotFoundError();
  const parent = await loadResource(db, c.parentType as ResourceType, c.parentId);
  if (!parent || !can(principal, "read", parent.resource).allow) throw new NotFoundError();
  return { c, orgId };
}

export const reportSchema = z.object({ reason: z.string().trim().min(3).max(500) });

/** Reporting needs only that the reporter can read the comment. It never discloses who else is in the thread. */
export async function reportComment(db: Db, principal: Principal, audit: AuditSink, commentId: string, raw: unknown) {
  const { reason } = reportSchema.parse(raw);
  const { c } = await readableComment(db, principal, audit, commentId);
  await db.insert(commentReports).values({ commentId: c.id, reporterId: principal.userId, reason });
}

/** The author, an administrator of that organisation, or a moderator may hide a comment. */
export async function hideComment(db: Db, principal: Principal, audit: AuditSink, commentId: string) {
  const [c] = await db.select().from(comments).where(eq(comments.id, commentId));
  if (!c) throw new NotFoundError();

  const moderator = can(principal, "moderate", { audience: "shared_community" }).allow;
  const sameTenant = clientTenantOf(principal) === c.orgId;
  const allowed = moderator || (sameTenant && (c.authorId === principal.userId || principal.activeRole === "client_admin"));
  if (!allowed) {
    // Indistinguishable from "does not exist" for anyone outside the comment's tenant.
    if (!sameTenant) throw new NotFoundError();
    await audit({ actorId: principal.userId, action: "moderate", subjectType: "comment", subjectId: commentId, orgId: c.orgId, allowed: false, reason: "not the author, an administrator or a moderator" });
    throw refuse("not permitted to hide this comment");
  }
  await db.update(comments).set({ status: "hidden" }).where(eq(comments.id, commentId));
  await audit({ actorId: principal.userId, action: "moderate", subjectType: "comment", subjectId: commentId, orgId: c.orgId, allowed: true, reason: moderator ? "moderator" : "author or organisation administrator" });
}

/** Moderators see reported comments with the reason, but not who reported them. */
export async function listReportedComments(db: Db, principal: Principal, audit: AuditSink) {
  await requirePermission({ principal, audit, subjectType: "comment_report" }, "moderate", { audience: "shared_community" });
  return db
    .select({ commentId: comments.id, body: comments.body, status: comments.status, reason: commentReports.reason, reportedAt: commentReports.createdAt })
    .from(commentReports)
    .innerJoin(comments, eq(comments.id, commentReports.commentId))
    .orderBy(desc(commentReports.createdAt));
}

// ---------------------------------------------------------------- support requests

export const supportSchema = z.object({
  subject: z.string().trim().min(4).max(140),
  body: z.string().trim().min(10).max(4000),
});

/** Recorded locally for the organisation. This is not a live service-desk integration. */
export async function createSupportRequest(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  const input = supportSchema.parse(raw);
  const orgId = await requireClientTenant(principal, audit);
  const [row] = await db.insert(supportRequests).values({ orgId, userId: principal.userId, ...input }).returning({ id: supportRequests.id });
  return row.id;
}

export async function listSupportRequests(db: Db, principal: Principal) {
  const orgId = clientTenantOf(principal);
  if (!orgId) return [];
  return db
    .select({ id: supportRequests.id, subject: supportRequests.subject, status: supportRequests.status, createdAt: supportRequests.createdAt, author: users.displayName })
    .from(supportRequests)
    .innerJoin(users, eq(users.id, supportRequests.userId))
    .where(eq(supportRequests.orgId, orgId))
    .orderBy(desc(supportRequests.createdAt));
}
