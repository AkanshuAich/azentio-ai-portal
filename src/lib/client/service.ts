import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import {
  contributions, improvementIdeas, invitations, liveSessions, mediaAssets, memberships,
  organizations, playgroundRuns, products, releaseNotes, savedScenarios, sessions, sharedPublications,
  themeEvidence, users,
} from "@/lib/db/schema";
import { ForbiddenError, requirePermission, type AuditSink } from "@/lib/authz/guard";
import { can } from "@/lib/authz/policy";
import type { Principal } from "@/lib/authz/types";
import { NotFoundError } from "@/lib/employee/service";
import { SCENARIOS, feedbackSchema, getScenario } from "@/lib/playground/scenarios";
import { withTenant } from "@/lib/db/tenant";

const refuse = (reason: string) => new ForbiddenError({ allow: false, reason });

/**
 * Every client-portal operation starts here. It returns the caller's ACTIVE organisation id, taken from
 * the server-built principal. A request can never name a different tenant, and an employee with no client
 * membership gets nothing, because employee status gives no automatic access to any client workspace.
 */
export async function requireClientTenant(principal: Principal, audit: AuditSink): Promise<string> {
  const isClient = principal.activeRole === "client_member" || principal.activeRole === "client_admin";
  if (!principal.activeOrgId || !isClient) {
    await audit({ actorId: principal.userId, action: "read", subjectType: "client_workspace", subjectId: null, orgId: null, allowed: false, reason: "client workspace required" });
    throw refuse("client workspace required");
  }
  await requirePermission({ principal, audit, subjectType: "client_workspace" }, "read", { audience: "tenant", orgId: principal.activeOrgId });
  return principal.activeOrgId;
}

/** Non-throwing variant for page rendering. */
export function clientTenantOf(principal: Principal): string | null {
  const isClient = principal.activeRole === "client_member" || principal.activeRole === "client_admin";
  return principal.activeOrgId && isClient ? principal.activeOrgId : null;
}

// ---------------------------------------------------------------- plain-language idea status

const STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed", under_review: "Under review", planned: "Planned",
  in_progress: "In progress", released: "Released", not_proceeding: "Not proceeding",
};
const NOT_A_COMMITMENT = new Set(["proposed", "under_review", "planned", "in_progress"]);

export interface ClientIdea {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  commitmentNote: string | null;
  ownerTeam: string;
  summary: string;
  updatedAt: Date;
}

/**
 * Ideas a client may see: published by a product owner (clientVisible) AND relevant, meaning the client
 * is entitled to the offering or its own approved contribution supports the idea's theme. The payload is
 * a whitelist: no priority, no internal problem statement, no prioritisation discussion.
 */
export async function listClientIdeas(db: Db, orgId: string, entitledSlugs: string[]): Promise<ClientIdea[]> {
  const candidates = await db.select().from(improvementIdeas).where(eq(improvementIdeas.clientVisible, true));
  if (candidates.length === 0) return [];

  const mine = await db
    .selectDistinct({ themeId: themeEvidence.themeId })
    .from(themeEvidence)
    .innerJoin(sharedPublications, eq(sharedPublications.id, themeEvidence.publicationId))
    .innerJoin(contributions, eq(contributions.id, sharedPublications.contributionId))
    .where(and(eq(contributions.orgId, orgId), isNull(sharedPublications.withdrawnAt)));
  const myThemes = new Set(mine.map((m) => m.themeId));

  return candidates
    .filter((i) => entitledSlugs.includes(i.offering) || (i.themeId !== null && myThemes.has(i.themeId)))
    .map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      statusLabel: STATUS_LABEL[i.status] ?? i.status,
      commitmentNote: NOT_A_COMMITMENT.has(i.status) ? "Not a commitment to deliver." : null,
      ownerTeam: i.ownerTeam,
      summary: i.clientSummary ?? "",
      updatedAt: i.updatedAt,
    }));
}

// ---------------------------------------------------------------- dashboard

export async function getClientDashboard(db: Db, principal: Principal, audit: AuditSink) {
  const orgId = await requireClientTenant(principal, audit);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  const slugs = [...principal.entitlements];

  const offerings = slugs.length
    ? await db.select({ slug: products.slug, name: products.name, summary: products.summary }).from(products).where(inArray(products.slug, slugs)).orderBy(asc(products.name))
    : [];
  const sandboxSlugs = new Set(SCENARIOS.map((s) => s.meta.productSlug));

  // Every row is checked against its own audience; the SQL does not decide.
  const media = (await db.select().from(mediaAssets).orderBy(desc(mediaAssets.createdAt)))
    .filter((m) => m.audience !== "public" && can(principal, "read", { audience: m.audience, orgId: m.ownerOrgId, entitlement: m.productSlug }).allow);
  const sessionsRows = (await db.select().from(liveSessions).orderBy(asc(liveSessions.startsAt)))
    .filter((s) => s.audience !== "public" && can(principal, "read", { audience: s.audience, orgId: s.ownerOrgId }).allow);

  // Contribution status: the caller's own items plus anything their organisation has chosen to share.
  const counts = await db
    .select({ status: contributions.status, n: sql<number>`count(*)::int` })
    .from(contributions)
    .where(and(eq(contributions.orgId, orgId), or(eq(contributions.authorId, principal.userId), sql`${contributions.sharingChoice} <> 'private'`)))
    .groupBy(contributions.status);

  return {
    org: { id: org.id, name: org.name },
    offerings: offerings.map((o) => ({ ...o, hasSandbox: sandboxSlugs.has(o.slug) })),
    demos: media.map((m) => ({ id: m.id, title: m.title, kind: m.kind, contentType: m.contentType })),
    sessions: sessionsRows.map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt, streamRef: s.streamRef, recordingAssetId: s.recordingAssetId })),
    contributions: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>,
    ideas: await listClientIdeas(db, orgId, slugs),
  };
}

// ---------------------------------------------------------------- entitled sandboxes

export function listSandboxes(principal: Principal) {
  if (!clientTenantOf(principal)) return [];
  return SCENARIOS.filter((s) => principal.entitlements.has(s.meta.productSlug)).map((s) => s.meta);
}

async function requireEntitled(principal: Principal, audit: AuditSink, productSlug: string, subjectId?: string) {
  const orgId = await requireClientTenant(principal, audit);
  await requirePermission({ principal, audit, subjectType: "sandbox", subjectId }, "read", { audience: "entitled", orgId, entitlement: productSlug });
  return orgId;
}

export async function runSandbox(db: Db, principal: Principal, audit: AuditSink, scenarioId: string, rawParams: unknown) {
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new NotFoundError();
  const orgId = await requireEntitled(principal, audit, scenario.meta.productSlug, scenarioId);

  const params = scenario.parse(rawParams);
  const output = scenario.run(params as never);
  const [run] = await db.insert(playgroundRuns).values({ userId: principal.userId, orgId, scenarioId, params, output }).returning({ id: playgroundRuns.id });
  return { id: run.id, output };
}

/** Runs are isolated by tenant AND user: another member, or this user in another workspace, never sees them. */
export async function listMySandboxRuns(db: Db, principal: Principal, limit = 8) {
  const orgId = clientTenantOf(principal);
  if (!orgId) return [];
  return withTenant(db, orgId, (q) => q
    .select({ id: playgroundRuns.id, scenarioId: playgroundRuns.scenarioId, createdAt: playgroundRuns.createdAt, feedback: playgroundRuns.feedback })
    .from(playgroundRuns)
    .where(and(eq(playgroundRuns.userId, principal.userId), eq(playgroundRuns.orgId, orgId)))
    .orderBy(desc(playgroundRuns.createdAt))
    .limit(limit));
}

export async function saveSandboxFeedback(db: Db, principal: Principal, audit: AuditSink, runId: string, raw: unknown) {
  const orgId = await requireClientTenant(principal, audit);
  const feedback = feedbackSchema.parse(raw);
  const updated = await db
    .update(playgroundRuns)
    .set({ feedback })
    .where(and(eq(playgroundRuns.id, runId), eq(playgroundRuns.userId, principal.userId), eq(playgroundRuns.orgId, orgId)))
    .returning({ id: playgroundRuns.id });
  if (updated.length === 0) throw new NotFoundError();
}

export const savedScenarioSchema = z.object({
  name: z.string().trim().min(2).max(80),
  scenarioId: z.string().max(80),
  params: z.record(z.string(), z.unknown()),
  visibility: z.enum(["private", "organisation"]).default("private"),
});

export async function saveScenario(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  const input = savedScenarioSchema.parse(raw);
  const scenario = getScenario(input.scenarioId);
  if (!scenario) throw new NotFoundError();
  const orgId = await requireEntitled(principal, audit, scenario.meta.productSlug, input.scenarioId);
  const params = scenario.parse(input.params); // only valid parameter sets are ever stored
  const [row] = await db
    .insert(savedScenarios)
    .values({ orgId, userId: principal.userId, name: input.name, scenarioId: input.scenarioId, params, visibility: input.visibility })
    .returning({ id: savedScenarios.id });
  return row.id;
}

/** The caller's own saved scenarios, plus ones colleagues shared within THIS organisation. */
export async function listSavedScenarios(db: Db, principal: Principal) {
  const orgId = clientTenantOf(principal);
  if (!orgId) return [];
  const rows = await withTenant(db, orgId, (q) => q
    .select({ s: savedScenarios, author: users.displayName })
    .from(savedScenarios)
    .innerJoin(users, eq(users.id, savedScenarios.userId))
    .where(and(eq(savedScenarios.orgId, orgId), or(eq(savedScenarios.userId, principal.userId), eq(savedScenarios.visibility, "organisation"))))
    .orderBy(desc(savedScenarios.createdAt)));
  // Entitlement can be withdrawn after saving: stop surfacing scenarios for products no longer entitled.
  return rows
    .filter((r) => { const sc = getScenario(r.s.scenarioId); return sc && principal.entitlements.has(sc.meta.productSlug); })
    .map((r) => ({ id: r.s.id, name: r.s.name, scenarioId: r.s.scenarioId, params: r.s.params as Record<string, number>, visibility: r.s.visibility, mine: r.s.userId === principal.userId, author: r.author }));
}

export async function deleteSavedScenario(db: Db, principal: Principal, audit: AuditSink, id: string) {
  const orgId = await requireClientTenant(principal, audit);
  const gone = await db
    .delete(savedScenarios)
    .where(and(eq(savedScenarios.id, id), eq(savedScenarios.orgId, orgId), eq(savedScenarios.userId, principal.userId)))
    .returning({ id: savedScenarios.id });
  if (gone.length === 0) throw new NotFoundError();
}

// ---------------------------------------------------------------- client resources

/** Briefings, release notes, sessions and media addressed to this client. Employee-only content never appears. */
export async function listClientResources(db: Db, principal: Principal, audit: AuditSink) {
  await requireClientTenant(principal, audit);
  const visible = (audience: Parameters<typeof can>[2]["audience"], orgId: string | null, entitlement?: string | null) =>
    audience !== "public" && can(principal, "read", { audience, orgId, entitlement }).allow;

  const notes = (await db.select().from(releaseNotes).orderBy(desc(releaseNotes.version))).filter((n) => visible(n.audience, n.ownerOrgId));
  const media = (await db.select().from(mediaAssets).orderBy(desc(mediaAssets.createdAt))).filter((m) => visible(m.audience, m.ownerOrgId, m.productSlug));
  const live = (await db.select().from(liveSessions).orderBy(asc(liveSessions.startsAt))).filter((s) => visible(s.audience, s.ownerOrgId));
  return {
    releaseNotes: notes.map((n) => ({ id: n.id, title: n.title, body: n.body })),
    media: media.map((m) => ({ id: m.id, title: m.title, kind: m.kind, contentType: m.contentType })),
    sessions: live.map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt, streamRef: s.streamRef, recordingAssetId: s.recordingAssetId })),
  };
}

// ---------------------------------------------------------------- members and invitations

export const CLIENT_ROLES = ["client_member", "client_admin"] as const;

export interface MemberRow { userId: string; name: string; email: string; role: string; status: string; you: boolean }
export interface InvitationRow { id: string; email: string; role: string; state: "pending" | "accepted" | "expired" | "cancelled"; expiresAt: Date; createdAt: Date }

/** Membership and invitation states for the caller's own organisation. Needs the right to invite there. */
export async function listMembers(db: Db, principal: Principal, audit: AuditSink, now = new Date()) {
  const orgId = await requireClientTenant(principal, audit);
  await requirePermission({ principal, audit, subjectType: "membership" }, "invite_member", { audience: "tenant", orgId });

  const m = await db
    .select({ userId: memberships.userId, name: users.displayName, email: users.email, role: memberships.role, status: memberships.status })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(asc(users.displayName));
  const inv = await db.select().from(invitations).where(eq(invitations.orgId, orgId)).orderBy(desc(invitations.createdAt));

  const members: MemberRow[] = m.map((r) => ({ ...r, you: r.userId === principal.userId }));
  const invites: InvitationRow[] = inv.map((i) => ({
    id: i.id, email: i.email, role: i.proposedRole,
    state: i.consumedAt ? "accepted" : i.revokedAt ? "cancelled" : i.expiresAt <= now ? "expired" : "pending",
    expiresAt: i.expiresAt, createdAt: i.createdAt,
  }));
  return { members, invitations: invites };
}

export async function changeMemberRole(db: Db, principal: Principal, audit: AuditSink, userId: string, role: unknown) {
  const next = z.enum(CLIENT_ROLES).parse(role);
  const orgId = await requireClientTenant(principal, audit);
  // The target role must be one this caller may grant here: client roles only, never platform roles.
  await requirePermission({ principal, audit, subjectType: "membership", subjectId: userId }, "grant_role", { audience: "tenant", orgId, targetRole: next });
  if (userId === principal.userId) throw refuse("administrators cannot change their own role");

  const updated = await db
    .update(memberships)
    .set({ role: next })
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId), eq(memberships.status, "active")))
    .returning({ id: memberships.id });
  if (updated.length === 0) throw new NotFoundError();
}

/** Revokes a member of the caller's organisation. Self-revocation is refused so an organisation is never left without an administrator. */
export async function revokeMember(db: Db, principal: Principal, audit: AuditSink, userId: string) {
  const orgId = await requireClientTenant(principal, audit);
  await requirePermission({ principal, audit, subjectType: "membership", subjectId: userId }, "invite_member", { audience: "tenant", orgId });
  if (userId === principal.userId) throw refuse("administrators cannot revoke themselves");

  const updated = await db
    .update(memberships)
    .set({ status: "revoked" })
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId), eq(memberships.status, "active")))
    .returning({ id: memberships.id });
  if (updated.length === 0) throw new NotFoundError();
  await db.update(sessions).set({ activeOrgId: null }).where(and(eq(sessions.userId, userId), eq(sessions.activeOrgId, orgId)));
}

export async function cancelInvitation(db: Db, principal: Principal, audit: AuditSink, invitationId: string, now = new Date()) {
  const orgId = await requireClientTenant(principal, audit);
  await requirePermission({ principal, audit, subjectType: "invitation", subjectId: invitationId }, "invite_member", { audience: "tenant", orgId });
  const updated = await db
    .update(invitations)
    .set({ revokedAt: now })
    .where(and(eq(invitations.id, invitationId), eq(invitations.orgId, orgId), isNull(invitations.consumedAt), isNull(invitations.revokedAt)))
    .returning({ id: invitations.id });
  if (updated.length === 0) throw new NotFoundError();
}

