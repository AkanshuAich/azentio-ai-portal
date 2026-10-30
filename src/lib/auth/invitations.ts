import { and, eq, isNull, gt } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { invitations, memberships, organizations, sessions, users } from "@/lib/db/schema";
import { requirePermission, type AuditSink } from "@/lib/authz/guard";
import type { MembershipRole, Principal } from "@/lib/authz/types";
import { queueEmail } from "@/lib/notifications/outbox";
import { isEmailShaped, newToken, normaliseEmail, sha256 } from "./crypto";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class InvitationError extends Error {
  constructor(public readonly code: "invalid_invitation" | "invalid_request" | "not_a_client_org") {
    super(code);
    this.name = "InvitationError";
  }
}

export interface InviteInput {
  orgId: string;
  email: string;
  role: MembershipRole;
}

/**
 * Invites someone into a client organisation. Needs BOTH the right to invite into that org AND the
 * right to grant the proposed role, so a client administrator can invite only within their own org
 * and can never propose an employee/moderator/publisher/admin role. Employees are provisioned through
 * the organiser allowlist, never by invitation.
 */
export async function createInvitation(
  db: Db,
  principal: Principal,
  audit: AuditSink,
  input: InviteInput,
  now = new Date(),
): Promise<{ invitationId: string; token: string }> {
  const email = normaliseEmail(input.email);
  if (!isEmailShaped(email)) throw new InvitationError("invalid_request");

  const ctx = { principal, audit, subjectType: "invitation" };
  await requirePermission(ctx, "invite_member", { audience: "tenant", orgId: input.orgId });
  await requirePermission(ctx, "grant_role", { audience: "tenant", orgId: input.orgId, targetRole: input.role });

  const [org] = await db.select().from(organizations).where(eq(organizations.id, input.orgId));
  if (!org || org.kind !== "client" || input.role === "employee") throw new InvitationError("not_a_client_org");

  const token = newToken();
  const [inv] = await db
    .insert(invitations)
    .values({
      orgId: input.orgId,
      email,
      proposedRole: input.role,
      tokenHash: sha256(token),
      invitedBy: principal.userId,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    })
    .returning({ id: invitations.id });

  const base = process.env.APP_URL ?? "http://localhost:3000";
  await queueEmail(db, {
    toEmail: email,
    subject: `You are invited to join ${org.name} on azentio.ai`,
    body: `You have been invited to join ${org.name} as ${input.role}. Open ${base}/invite/${token} and sign in with this email address. The link works once and expires in 7 days.`,
    secret: true,
    idempotencyKey: `invite:${inv.id}`,
  });

  return { invitationId: inv.id, token };
}

/** What an invitation page may show before sign-in. Reveals nothing for an unknown or spent token. */
export async function describeInvitation(db: Db, token: string, now = new Date()) {
  const [row] = await db
    .select({ orgName: organizations.name, role: invitations.proposedRole })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.consumedAt), gt(invitations.expiresAt, now)));
  return row ?? null;
}

/**
 * Accepts an invitation for the signed-in, verified account it was issued to. The token is single-use:
 * the consume step is an atomic conditional update, so two concurrent acceptances cannot both succeed.
 */
export async function acceptInvitation(
  db: Db,
  token: string,
  userId: string,
  audit: AuditSink,
  now = new Date(),
): Promise<{ orgId: string }> {
  const [inv] = await db.select().from(invitations).where(eq(invitations.tokenHash, sha256(token)));
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  // One generic failure for every reason, so the response never says which condition failed.
  const ok =
    inv && user && !inv.consumedAt && inv.expiresAt > now &&
    user.emailVerifiedAt !== null && user.email === inv.email;
  if (!ok) {
    await audit({
      actorId: userId, action: "invite_member", subjectType: "invitation_accept",
      subjectId: inv?.id ?? null, orgId: inv?.orgId ?? null, allowed: false, reason: "invitation rejected",
    });
    throw new InvitationError("invalid_invitation");
  }

  await db.transaction(async (tx) => {
    const consumed = await tx
      .update(invitations)
      .set({ consumedAt: now })
      .where(and(eq(invitations.id, inv.id), isNull(invitations.consumedAt)))
      .returning({ id: invitations.id });
    if (consumed.length === 0) throw new InvitationError("invalid_invitation");

    await tx
      .insert(memberships)
      .values({ userId, orgId: inv.orgId, role: inv.proposedRole, status: "active", approvedBy: inv.invitedBy })
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.orgId],
        // Re-joining after revocation. Never downgrades or alters an already-active membership.
        set: { status: "active", role: inv.proposedRole, approvedBy: inv.invitedBy, termsAcceptedAt: null },
        setWhere: eq(memberships.status, "revoked"),
      });
  });

  await audit({
    actorId: userId, action: "invite_member", subjectType: "invitation_accept",
    subjectId: inv.id, orgId: inv.orgId, allowed: true, reason: "invitation accepted",
  });
  return { orgId: inv.orgId };
}

/** Revokes a membership in the caller's own organisation and ends that member's sessions in it. */
export async function revokeMembership(
  db: Db,
  principal: Principal,
  audit: AuditSink,
  orgId: string,
  targetUserId: string,
): Promise<void> {
  await requirePermission(
    { principal, audit, subjectType: "membership", subjectId: targetUserId },
    "invite_member",
    { audience: "tenant", orgId },
  );
  await db
    .update(memberships)
    .set({ status: "revoked" })
    .where(and(eq(memberships.userId, targetUserId), eq(memberships.orgId, orgId)));
  await db
    .update(sessions)
    .set({ activeOrgId: null })
    .where(and(eq(sessions.userId, targetUserId), eq(sessions.activeOrgId, orgId)));
}
