import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import {
  experiments, hackathonTeamMembers, hackathonTeams, knowledgeArticles, knowledgeFeedback, liveSessions,
  mediaAssets, organizations, playgroundRuns, products, releaseNotes, siteBanners, users,
} from "@/lib/db/schema";
import { requirePermission, type AuditSink } from "@/lib/authz/guard";
import { can } from "@/lib/authz/policy";
import type { Principal } from "@/lib/authz/types";
import { SCENARIOS, feedbackSchema, getScenario } from "@/lib/playground/scenarios";
import { checkUpload, newStorageKey, putObject } from "@/lib/storage/private";

export class NotFoundError extends Error {
  constructor() {
    super("not_found");
    this.name = "NotFoundError";
  }
}

// Employee-facing writes always store the employee audience. The client can never choose it.
const EMPLOYEE = { audience: "employee" } as const;
const guard = (principal: Principal, audit: AuditSink) => ({ principal, audit });

// ---------------------------------------------------------------- playground

export async function runScenario(db: Db, principal: Principal, audit: AuditSink, scenarioId: string, rawParams: unknown) {
  await requirePermission(guard(principal, audit), "read", EMPLOYEE);
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new NotFoundError();

  const params = scenario.parse(rawParams);
  const output = scenario.run(params as never);
  const [run] = await db
    .insert(playgroundRuns)
    .values({ userId: principal.userId, orgId: null, scenarioId, params, output })
    .returning({ id: playgroundRuns.id });
  return { id: run.id, output };
}

/** Feedback is accepted only from the run's own author. */
export async function saveRunFeedback(db: Db, principal: Principal, audit: AuditSink, runId: string, raw: unknown) {
  await requirePermission(guard(principal, audit), "read", EMPLOYEE);
  const feedback = feedbackSchema.parse(raw);
  const updated = await db
    .update(playgroundRuns)
    .set({ feedback })
    .where(and(eq(playgroundRuns.id, runId), eq(playgroundRuns.userId, principal.userId), isNull(playgroundRuns.orgId)))
    .returning({ id: playgroundRuns.id });
  if (updated.length === 0) throw new NotFoundError();
}

export async function listMyRuns(db: Db, principal: Principal, limit = 8) {
  if (!can(principal, "read", EMPLOYEE).allow) return [];
  return db
    .select({ id: playgroundRuns.id, scenarioId: playgroundRuns.scenarioId, createdAt: playgroundRuns.createdAt, feedback: playgroundRuns.feedback })
    .from(playgroundRuns)
    .where(and(eq(playgroundRuns.userId, principal.userId), isNull(playgroundRuns.orgId)))
    .orderBy(desc(playgroundRuns.createdAt))
    .limit(limit);
}

export const scenarioTitles = () => new Map(SCENARIOS.map((s) => [s.meta.id, s.meta.title]));

// ---------------------------------------------------------------- experiments

export const experimentSchema = z.object({
  title: z.string().trim().min(4).max(120),
  hypothesis: z.string().trim().min(10).max(1000),
  expectedOutcome: z.string().trim().max(600).optional().transform((v) => v || undefined),
});

export async function listExperiments(db: Db, principal: Principal) {
  if (!can(principal, "read", EMPLOYEE).allow) return [];
  return db
    .select({
      id: experiments.id, title: experiments.title, hypothesis: experiments.hypothesis,
      expectedOutcome: experiments.expectedOutcome, status: experiments.status, ownerId: experiments.ownerId,
      ownerName: users.displayName, updatedAt: experiments.updatedAt,
    })
    .from(experiments)
    .innerJoin(users, eq(users.id, experiments.ownerId))
    .where(eq(experiments.audience, "employee"))
    .orderBy(desc(experiments.updatedAt));
}

export async function createExperiment(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requirePermission(guard(principal, audit), "write", EMPLOYEE);
  const input = experimentSchema.parse(raw);
  const [row] = await db
    .insert(experiments)
    .values({ ...input, expectedOutcome: input.expectedOutcome ?? null, ownerId: principal.userId, audience: "employee" })
    .returning({ id: experiments.id });
  return row.id;
}

export const EXPERIMENT_STATUSES = ["proposed", "running", "concluded"] as const;

/** Only the experiment's owner moves its status. */
export async function setExperimentStatus(db: Db, principal: Principal, audit: AuditSink, id: string, status: unknown) {
  await requirePermission(guard(principal, audit), "write", EMPLOYEE);
  const next = z.enum(EXPERIMENT_STATUSES).parse(status);
  const updated = await db
    .update(experiments)
    .set({ status: next, updatedAt: new Date() })
    .where(and(eq(experiments.id, id), eq(experiments.ownerId, principal.userId)))
    .returning({ id: experiments.id });
  if (updated.length === 0) throw new NotFoundError();
}

// ---------------------------------------------------------------- hackathon teams

export const teamSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().min(10).max(500),
});

export async function listTeams(db: Db, principal: Principal) {
  if (!can(principal, "read", EMPLOYEE).allow) return [];
  const teams = await db.select().from(hackathonTeams).where(eq(hackathonTeams.audience, "employee")).orderBy(asc(hackathonTeams.name));
  const members = await db
    .select({ teamId: hackathonTeamMembers.teamId, userId: hackathonTeamMembers.userId, name: users.displayName })
    .from(hackathonTeamMembers)
    .innerJoin(users, eq(users.id, hackathonTeamMembers.userId));
  return teams.map((t) => ({
    id: t.id, name: t.name, description: t.description,
    members: members.filter((m) => m.teamId === t.id).map((m) => ({ userId: m.userId, name: m.name })),
  }));
}

export async function createTeam(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requirePermission(guard(principal, audit), "write", EMPLOYEE);
  const input = teamSchema.parse(raw);
  const id = await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(hackathonTeams)
      .values({ ...input, createdBy: principal.userId, audience: "employee" })
      .returning({ id: hackathonTeams.id });
    await tx.insert(hackathonTeamMembers).values({ teamId: t.id, userId: principal.userId });
    return t.id;
  });
  return id;
}

export async function setTeamMembership(db: Db, principal: Principal, audit: AuditSink, teamId: string, action: "join" | "leave") {
  await requirePermission(guard(principal, audit), "write", EMPLOYEE);
  const [team] = await db.select({ id: hackathonTeams.id }).from(hackathonTeams).where(and(eq(hackathonTeams.id, teamId), eq(hackathonTeams.audience, "employee")));
  if (!team) throw new NotFoundError();
  if (action === "join") {
    await db.insert(hackathonTeamMembers).values({ teamId, userId: principal.userId }).onConflictDoNothing();
  } else {
    await db.delete(hackathonTeamMembers).where(and(eq(hackathonTeamMembers.teamId, teamId), eq(hackathonTeamMembers.userId, principal.userId)));
  }
}

// ---------------------------------------------------------------- knowledge library

export const articleSchema = z.object({
  title: z.string().trim().min(4).max(140),
  body: z.string().trim().min(20).max(8000),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});

export async function listArticles(db: Db, principal: Principal, today = new Date()) {
  if (!can(principal, "read", EMPLOYEE).allow) return [];
  const rows = await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.audience, "employee")).orderBy(asc(knowledgeArticles.reviewDate));
  const fb = await db
    .select({
      articleId: knowledgeFeedback.articleId,
      useful: sql<number>`count(*) filter (where ${knowledgeFeedback.useful})::int`,
      notUseful: sql<number>`count(*) filter (where not ${knowledgeFeedback.useful})::int`,
    })
    .from(knowledgeFeedback)
    .groupBy(knowledgeFeedback.articleId);
  const iso = today.toISOString().slice(0, 10);
  return rows.map((a) => {
    const f = fb.find((x) => x.articleId === a.id);
    return {
      id: a.id, title: a.title, body: a.body, ownerName: a.ownerName, reviewDate: a.reviewDate,
      reviewOverdue: a.reviewDate < iso,
      useful: f?.useful ?? 0, notUseful: f?.notUseful ?? 0,
    };
  });
}

export async function createArticle(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requirePermission(guard(principal, audit), "write", EMPLOYEE);
  const input = articleSchema.parse(raw);
  const [me] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, principal.userId));
  const [row] = await db
    .insert(knowledgeArticles)
    .values({ ...input, ownerName: me.name, createdBy: principal.userId, audience: "employee" })
    .returning({ id: knowledgeArticles.id });
  return row.id;
}

export const articleFeedbackSchema = z.object({
  useful: z.boolean(),
  comment: z.string().trim().max(400).optional().transform((v) => v || undefined),
});

/** One feedback row per employee per article; submitting again replaces it. */
export async function giveArticleFeedback(db: Db, principal: Principal, audit: AuditSink, articleId: string, raw: unknown) {
  await requirePermission(guard(principal, audit), "read", EMPLOYEE);
  const input = articleFeedbackSchema.parse(raw);
  const [a] = await db.select({ id: knowledgeArticles.id }).from(knowledgeArticles).where(and(eq(knowledgeArticles.id, articleId), eq(knowledgeArticles.audience, "employee")));
  if (!a) throw new NotFoundError();
  await db
    .insert(knowledgeFeedback)
    .values({ articleId, userId: principal.userId, useful: input.useful, comment: input.comment ?? null })
    .onConflictDoUpdate({ target: [knowledgeFeedback.articleId, knowledgeFeedback.userId], set: { useful: input.useful, comment: input.comment ?? null } });
}

// ---------------------------------------------------------------- live sessions and release notes

type LiveRow = typeof liveSessions.$inferSelect;
const liveVisible = (p: Principal | null, r: LiveRow) => can(p, "read", { audience: r.audience, orgId: r.ownerOrgId }).allow;

/** Every session is checked against its own audience; the SQL does not pre-filter, the policy decides. */
export async function listLiveSessions(db: Db, principal: Principal | null) {
  const rows = await db.select().from(liveSessions).orderBy(desc(liveSessions.startsAt));
  return rows.filter((r) => liveVisible(principal, r));
}

export async function getLiveSession(db: Db, principal: Principal | null, id: string): Promise<LiveRow | "forbidden" | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(liveSessions).where(eq(liveSessions.id, id));
  if (!row) return null;
  return liveVisible(principal, row) ? row : "forbidden";
}

// A publisher chooses who sees a piece of content. Tenant audiences name ONE client organisation and
// entitled audiences name ONE product; combinations that don't make sense are rejected up front.
const audienceTarget = {
  orgId: z.string().uuid().optional(),
  productSlug: z.string().trim().max(80).optional(),
};

function requireTarget(v: { audience: string; orgId?: string; productSlug?: string }, ctx: z.RefinementCtx) {
  if (v.audience === "tenant" && !v.orgId) ctx.addIssue({ code: "custom", path: ["orgId"], message: "Choose the client organisation" });
  if (v.audience === "entitled" && !v.productSlug) ctx.addIssue({ code: "custom", path: ["productSlug"], message: "Choose the product" });
}

async function assertClientOrg(db: Db, orgId: string) {
  const [o] = await db.select({ kind: organizations.kind }).from(organizations).where(eq(organizations.id, orgId));
  if (!o || o.kind !== "client") throw new NotFoundError();
}

async function assertProduct(db: Db, slug: string) {
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug));
  if (!p) throw new NotFoundError();
}

export const releaseNoteSchema = z
  .object({
    title: z.string().trim().min(4).max(140),
    body: z.string().trim().min(10).max(4000),
    audience: z.enum(["employee", "public", "tenant"]).default("employee"),
    orgId: audienceTarget.orgId,
  })
  .superRefine(requireTarget);

export async function listReleaseNotes(db: Db, principal: Principal) {
  const rows = await db.select().from(releaseNotes).orderBy(desc(releaseNotes.version), asc(releaseNotes.title));
  return rows.filter((r) => can(principal, "read", { audience: r.audience, orgId: r.ownerOrgId }).allow);
}

/** Publishing release notes is a separate grant: ordinary employees can read but not publish. */
export async function createReleaseNote(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requirePermission({ ...guard(principal, audit), subjectType: "release_note" }, "publish_media", EMPLOYEE);
  const input = releaseNoteSchema.parse(raw);
  if (input.audience === "tenant") await assertClientOrg(db, input.orgId!);
  const [row] = await db
    .insert(releaseNotes)
    .values({ title: input.title, body: input.body, audience: input.audience, ownerOrgId: input.audience === "tenant" ? input.orgId! : null })
    .returning({ id: releaseNotes.id });
  return row.id;
}

// ---------------------------------------------------------------- publishing console

export const PUBLISH_AUDIENCES = ["employee", "public", "tenant", "entitled"] as const;

export const liveSessionSchema = z
  .object({
    title: z.string().trim().min(4).max(140),
    startsAt: z.string().datetime().optional(),
    // https only: zod's url() would also accept javascript: and data: schemes, which must never reach a link.
    streamRef: z.string().trim().max(500).refine((v) => /^https:\/\/[^\s]+$/i.test(v), "Stream link must be an https URL")
      .optional().or(z.literal("").transform(() => undefined)),
    audience: z.enum(["employee", "public", "tenant"]),
    orgId: audienceTarget.orgId,
  })
  .superRefine(requireTarget);

export async function createLiveSession(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requirePermission({ ...guard(principal, audit), subjectType: "live_session" }, "publish_media", EMPLOYEE);
  const input = liveSessionSchema.parse(raw);
  if (input.audience === "tenant") await assertClientOrg(db, input.orgId!);
  const [row] = await db
    .insert(liveSessions)
    .values({
      title: input.title, startsAt: input.startsAt ? new Date(input.startsAt) : null, streamRef: input.streamRef ?? null,
      audience: input.audience, ownerOrgId: input.audience === "tenant" ? input.orgId! : null,
    })
    .returning({ id: liveSessions.id });
  return row.id;
}

export const mediaMetaSchema = z
  .object({
    title: z.string().trim().min(2).max(140),
    kind: z.enum(["video", "recording", "image", "document"]),
    audience: z.enum(PUBLISH_AUDIENCES),
    liveSessionId: z.string().uuid().optional(),
    ...audienceTarget,
  })
  .superRefine(requireTarget);

/** Stores an uploaded file in private storage. The type is verified from the bytes, not the filename. */
export async function uploadMedia(
  db: Db, principal: Principal, audit: AuditSink, meta: unknown, declaredType: string, bytes: Uint8Array,
) {
  await requirePermission({ ...guard(principal, audit), subjectType: "media_asset" }, "publish_media", EMPLOYEE);
  const input = mediaMetaSchema.parse(meta);
  const check = checkUpload(declaredType, bytes);
  if (!check.ok) throw new UploadRejected(check.reason);
  if (input.audience === "tenant") await assertClientOrg(db, input.orgId!);
  if (input.audience === "entitled") await assertProduct(db, input.productSlug!);

  const key = newStorageKey(check.ext);
  await putObject(key, bytes);
  const [row] = await db
    .insert(mediaAssets)
    .values({
      title: input.title, kind: input.kind, storageKey: key, contentType: declaredType, byteSize: bytes.length,
      audience: input.audience,
      ownerOrgId: input.audience === "tenant" ? input.orgId! : null,
      productSlug: input.audience === "entitled" ? input.productSlug! : null,
    })
    .returning({ id: mediaAssets.id });

  if (input.liveSessionId) {
    await db.update(liveSessions).set({ recordingAssetId: row.id }).where(eq(liveSessions.id, input.liveSessionId));
  }
  return row.id;
}

export class UploadRejected extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "UploadRejected";
  }
}

const audienceChange = z
  .object({ audience: z.enum(PUBLISH_AUDIENCES), ...audienceTarget })
  .superRefine(requireTarget);

/** Changing who can see a piece of media is audited. Widening it is the consequential direction. */
export async function setMediaAudience(
  db: Db, principal: Principal, audit: AuditSink, id: string, audience: unknown,
  target: { orgId?: string; productSlug?: string } = {},
) {
  await requirePermission({ ...guard(principal, audit), subjectType: "media_asset", subjectId: id }, "publish_media", EMPLOYEE);
  const next = audienceChange.parse({ audience, ...target });
  if (next.audience === "tenant") await assertClientOrg(db, next.orgId!);
  if (next.audience === "entitled") await assertProduct(db, next.productSlug!);
  const updated = await db
    .update(mediaAssets)
    .set({
      audience: next.audience,
      ownerOrgId: next.audience === "tenant" ? next.orgId! : null,
      productSlug: next.audience === "entitled" ? next.productSlug! : null,
    })
    .where(eq(mediaAssets.id, id))
    .returning({ id: mediaAssets.id });
  if (updated.length === 0) throw new NotFoundError();
}

export const bannerSchema = z.object({
  message: z.string().trim().min(3).max(200),
  href: z.string().trim().max(300).optional().transform((v) => v || undefined)
    .refine((v) => v === undefined || /^(\/(?!\/)|https:\/\/)/.test(v), "Link must be a site path or an https URL"),
  active: z.boolean(),
});

/** One banner row, replaced as a whole. Public by design, and only a publisher may change it. */
export async function setBanner(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requirePermission({ ...guard(principal, audit), subjectType: "site_banner" }, "publish_media", EMPLOYEE);
  const input = bannerSchema.parse(raw);
  await db.delete(siteBanners);
  await db.insert(siteBanners).values({ message: input.message, href: input.href ?? null, active: input.active, audience: "public", updatedBy: principal.userId });
}

/** The banner shown on the public site: active and explicitly public. */
export async function activePublicBanner(db: Db) {
  const [b] = await db.select().from(siteBanners).where(and(eq(siteBanners.active, true), eq(siteBanners.audience, "public"))).limit(1);
  return b && can(null, "read", { audience: b.audience }).allow ? { message: b.message, href: b.href } : null;
}

/** Direct API reads of employee-only collections are refused outright, not answered with an empty list. */
export async function assertEmployee(principal: Principal, audit: AuditSink) {
  await requirePermission(guard(principal, audit), "read", EMPLOYEE);
}
