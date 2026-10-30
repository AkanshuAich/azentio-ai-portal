import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  appState, contributionEvents, contributions, notifications, organizations, platformGrants, products,
} from "@/lib/db/schema";
import { ForbiddenError, type AuditSink } from "@/lib/authz/guard";
import type { Principal, Resource } from "@/lib/authz/types";
import { NotFoundError } from "@/lib/employee/service";
import { notify } from "@/lib/notifications/inapp";
import { LifecycleError, assertTransition, type Actor, type Status } from "./lifecycle";

/** A database handle or an open transaction: anything that can run these four verbs. */
export type Q = Pick<Db, "select" | "insert" | "update" | "delete">;
export type Contribution = typeof contributions.$inferSelect;

export const refuse = (reason: string) => new ForbiddenError({ allow: false, reason });
export { NotFoundError, LifecycleError };

/**
 * The policy resource for a private SOURCE contribution. Drafts and private items are author-only;
 * once an item is submitted or shared within the organisation, the organisation's members may read it.
 * The tenant comes from the stored row, never from the request.
 */
export function orgVisible(c: Pick<Contribution, "status" | "sharingChoice" | "orgSharedAt">): boolean {
  // Explicitly shared with the organisation by the author, or submitted and proposed for community sharing.
  return c.orgSharedAt !== null || (c.status !== "draft" && c.sharingChoice === "propose_shared");
}

export function sourceResource(c: Pick<Contribution, "orgId" | "authorId" | "status" | "sharingChoice" | "orgSharedAt">): Resource {
  return !orgVisible(c)
    ? { audience: "tenant_private", orgId: c.orgId, ownerId: c.authorId }
    : { audience: "tenant", orgId: c.orgId };
}

/** Names the scanner should look for: every client organisation. */
export async function knownClientNames(q: Q): Promise<string[]> {
  const rows = await q.select({ name: organizations.name }).from(organizations).where(eq(organizations.kind, "client"));
  return rows.map((r) => r.name);
}

export async function assertOfferingExists(q: Q, slug: string) {
  const [p] = await q.select({ id: products.id }).from(products).where(eq(products.slug, slug));
  if (!p) throw new NotFoundError();
}

/** Bumps the epoch that cached feed aggregates are keyed on. Called on every publish and withdraw. */
export async function bumpEpoch(q: Q) {
  await q
    .insert(appState)
    .values({ key: "feed_epoch", value: 1 })
    .onConflictDoUpdate({ target: appState.key, set: { value: sql`${appState.value} + 1` } });
}

export async function readEpoch(q: Q): Promise<number> {
  const [r] = await q.select({ v: appState.value }).from(appState).where(eq(appState.key, "feed_epoch"));
  return r?.v ?? 0;
}

export interface TransitionCtx {
  q: Q;
  audit: AuditSink;
  actorId: string;
  actor: Actor;
}

/**
 * Moves a contribution to a new status. It checks the transition table, applies the change only if the
 * row is still in the state we read (so two racing requests cannot both win), and records an
 * author-visible event. The audit write is returned to the caller to run after commit.
 */
export async function applyTransition(
  ctx: TransitionCtx, c: Contribution, to: Status, note: string | null,
  extra: Partial<typeof contributions.$inferInsert> = {},
): Promise<() => Promise<void>> {
  assertTransition(c.status, to, ctx.actor);
  const updated = await ctx.q
    .update(contributions)
    .set({ status: to, updatedAt: new Date(), ...extra })
    .where(and(eq(contributions.id, c.id), eq(contributions.status, c.status)))
    .returning({ id: contributions.id });
  if (updated.length === 0) throw new LifecycleError(c.status, to, ctx.actor);

  await ctx.q.insert(contributionEvents).values({ contributionId: c.id, actorType: ctx.actor, fromStatus: c.status, toStatus: to, note });
  return () =>
    Promise.resolve(
      ctx.audit({
        actorId: ctx.actorId, action: ctx.actor === "moderator" ? "moderate" : "write", subjectType: "contribution", subjectId: c.id,
        orgId: c.orgId, allowed: true, reason: `${c.status} -> ${to}`, detail: { from: c.status, to, actor: ctx.actor, version: c.version },
      }),
    );
}

/** Tells the author about a state change, in-app only. Never claims an email was sent. */
export async function tellAuthor(db: Db, c: Pick<Contribution, "authorId" | "title">, message: string) {
  await notify(db, c.authorId, `${message}: "${c.title}"`, "/workspace/observations");
}

/**
 * In-app note to everyone currently holding the moderation grant. It says only that something is waiting:
 * no title, no organisation, nothing from the contribution.
 */
export async function notifyModerators(db: Db, message: string) {
  const grants = await db
    .select({ userId: platformGrants.userId })
    .from(platformGrants)
    .where(and(eq(platformGrants.permission, "learning.moderate"), or(isNull(platformGrants.expiresAt), gt(platformGrants.expiresAt, new Date()))));
  const ids = [...new Set(grants.map((x) => x.userId))];
  // One insert for everyone, not one round trip each.
  if (ids.length) await db.insert(notifications).values(ids.map((userId) => ({ userId, message, href: "/employee/moderation" })));
}

export function isAuthor(principal: Principal, c: Pick<Contribution, "authorId" | "orgId">): boolean {
  return c.authorId === principal.userId && c.orgId === principal.activeOrgId;
}
