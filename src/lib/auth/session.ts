import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  entitlements, memberships, organizations, platformGrants, sessions, users,
} from "@/lib/db/schema";
import { buildPrincipal } from "@/lib/authz/principal";
import type { MembershipRole, Permission, Principal } from "@/lib/authz/types";
import { newToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "az_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface Workspace {
  orgId: string;
  orgName: string;
  orgKind: "azentio" | "client";
  role: MembershipRole;
  termsAccepted: boolean;
}

export interface SessionContext {
  sessionId: string;
  user: { id: string; email: string; displayName: string };
  principal: Principal;
  /** Every active membership, for the workspace switcher. Display only: authority is in `principal`. */
  workspaces: Workspace[];
}

async function acceptedWorkspaces(db: Db, userId: string): Promise<Workspace[]> {
  const rows = await db
    .select({
      orgId: memberships.orgId,
      orgName: organizations.name,
      orgKind: organizations.kind,
      role: memberships.role,
      termsAcceptedAt: memberships.termsAcceptedAt,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
  return rows.map((r) => ({
    orgId: r.orgId, orgName: r.orgName, orgKind: r.orgKind, role: r.role,
    termsAccepted: r.termsAcceptedAt !== null,
  }));
}

/**
 * Starts a session. With exactly one usable workspace it becomes active; with several the user must
 * choose explicitly, so authority is never silently picked for them.
 */
export async function createSession(db: Db, userId: string, now = new Date()) {
  const usable = (await acceptedWorkspaces(db, userId)).filter((w) => w.termsAccepted);
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    activeOrgId: usable.length === 1 ? usable[0].orgId : null,
    expiresAt,
  });
  return { token, expiresAt };
}

/** Rebuilds the caller's authority from stored records on every request. */
export async function loadSession(db: Db, token: string | undefined | null, now = new Date()): Promise<SessionContext | null> {
  if (!token) return null;
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)));
  if (!s) return null;

  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  if (!u) return null;

  const workspaces = await acceptedWorkspaces(db, u.id);
  const grants = await db
    .select({ permission: platformGrants.permission, expiresAt: platformGrants.expiresAt })
    .from(platformGrants)
    .where(eq(platformGrants.userId, u.id));

  // A workspace whose terms are not yet accepted confers nothing: treat it as not active.
  const usable = workspaces.filter((w) => w.termsAccepted);
  const activeOrgId = s.activeOrgId && usable.some((w) => w.orgId === s.activeOrgId) ? s.activeOrgId : null;
  const ent = activeOrgId
    ? await db.select({ slug: entitlements.productSlug }).from(entitlements).where(eq(entitlements.orgId, activeOrgId))
    : [];

  const approvals = await db
    .select({ orgId: memberships.orgId, approvedBy: memberships.approvedBy })
    .from(memberships)
    .where(eq(memberships.userId, u.id));
  const approvedBy = new Map(approvals.map((a) => [a.orgId, a.approvedBy]));

  const principal = buildPrincipal({
    userId: u.id,
    email: u.email,
    emailVerified: u.emailVerifiedAt !== null,
    memberships: usable.map((w) => ({
      orgId: w.orgId, orgKind: w.orgKind, role: w.role, status: "active" as const,
      approvedBy: approvedBy.get(w.orgId) ?? null,
    })),
    grants: grants.map((g) => ({ permission: g.permission as Permission, expiresAt: g.expiresAt })),
    sessionActiveOrgId: activeOrgId,
    entitlements: ent.map((e) => e.slug),
    now,
  });

  return {
    sessionId: s.id,
    user: { id: u.id, email: u.email, displayName: u.displayName },
    principal,
    workspaces,
  };
}

export async function destroySession(db: Db, token: string | undefined | null) {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

/** Switches the active workspace, only into one the user holds an active, terms-accepted membership in. */
export async function switchWorkspace(db: Db, token: string, orgId: string, now = new Date()): Promise<boolean> {
  const ctx = await loadSession(db, token, now);
  if (!ctx) return false;
  const target = ctx.workspaces.find((w) => w.orgId === orgId);
  if (!target || !target.termsAccepted) return false;
  await db.update(sessions).set({ activeOrgId: orgId }).where(eq(sessions.id, ctx.sessionId));
  return true;
}

/** Records acceptance of workspace terms and the learning-sharing explanation. This is not consent to share. */
export async function acceptTerms(db: Db, userId: string, orgId: string, now = new Date()): Promise<boolean> {
  const updated = await db
    .update(memberships)
    .set({ termsAcceptedAt: now })
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId), eq(memberships.status, "active")))
    .returning({ id: memberships.id });
  return updated.length > 0;
}
