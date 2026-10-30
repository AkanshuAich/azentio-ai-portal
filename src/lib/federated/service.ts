import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import {
  flDecisions, flEnrolments, flModelVersions, flProgrammes, flRounds, flRuns, flUpdates, organizations,
} from "@/lib/db/schema";
import { ForbiddenError, requirePermission, type AuditSink } from "@/lib/authz/guard";
import { can } from "@/lib/authz/policy";
import type { Principal } from "@/lib/authz/types";
import { DEFAULT_AGG } from "./aggregate";
import { DEFAULT_RUN, runProgramme, type RunConfig } from "./coordinator";
import type { DpReport } from "./dp";
import { PROFILE_NAMES } from "./data";
import { FederatedError } from "./errors";
import { injectFault, type FaultKind } from "./faults";
import { seedFor } from "./prng";
import type { EvalReport } from "./types";
import { buildClients, holdoutFor, provisionClient, standaloneBaselines } from "./wiring";

const RES = { audience: "employee" } as const;
export const CONSENT_VERSION = "fl_consent_v1";

/** What a client administrator acknowledges when enrolling. Shown verbatim in the UI. */
export const CONSENT_STATEMENTS = [
  "This is a SIMULATED programme on SYNTHETIC data. No real client records are used or moved.",
  "Only model-weight updates and an example count leave the simulated client environment. Rows and labels stay there.",
  "Plain averaging is not secure aggregation: the coordinator sees each individual update. No privacy guarantee is claimed unless noise is enabled and its accountant is shown.",
  "Withdrawing stops future participation. It does not remove your influence from models already trained: affected models are flagged for review, not untrained.",
];

const PROFILE_ROTATION = ["seasonal_heavy", "genuine_heavy", "balanced", "small_noisy"];

const programmeRow = async (db: Db) => {
  const [p] = await db.select().from(flProgrammes).orderBy(asc(flProgrammes.createdAt)).limit(1);
  if (!p) throw new FederatedError("no_programme", "no federated programme is configured");
  return p;
};

const isClientRole = (p: Principal) => p.activeRole === "client_member" || p.activeRole === "client_admin";

// ---------------------------------------------------------------------------------------------------------
// Client administrators: enrol and withdraw their own organisation. Authority comes from the session only.
// ---------------------------------------------------------------------------------------------------------

async function requireClientAdmin(principal: Principal, audit: AuditSink, subjectId: string) {
  if (principal.activeRole === "client_admin" && principal.activeOrgId && !principal.isEmployee) return principal.activeOrgId;
  await audit({ actorId: principal.userId, action: "write", subjectType: "fl_enrolment", subjectId, orgId: principal.activeOrgId, allowed: false, reason: "only a client administrator of the active organisation may enrol or withdraw" });
  throw new ForbiddenError({ allow: false, reason: "only a client administrator may change federated participation" });
}

const enrolSchema = z.object({
  acknowledge: z.literal(true),
  profile: z.enum(PROFILE_NAMES as [string, ...string[]]).optional(),
});

export async function enrol(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  // Authorise before touching any programme state, so a refusal reveals nothing about it.
  const orgId = await requireClientAdmin(principal, audit, "fl_programme");
  const programme = await programmeRow(db);
  const parsed = enrolSchema.safeParse(raw);
  if (!parsed.success) throw new FederatedError("consent_required", "enrolment needs an explicit acknowledgement");

  const [existing] = await db.select().from(flEnrolments).where(and(eq(flEnrolments.programmeId, programme.id), eq(flEnrolments.orgId, orgId)));
  if (existing?.status === "enrolled") throw new FederatedError("already_enrolled", "this organisation is already enrolled");

  const profile = parsed.data.profile ?? existing?.profile ?? PROFILE_ROTATION[(await db.select({ id: flEnrolments.id }).from(flEnrolments).where(eq(flEnrolments.programmeId, programme.id))).length % PROFILE_ROTATION.length];
  // The dataset is provisioned inside the simulated client environment, through the wiring boundary.
  await provisionClient(orgId, profile, programme.id);

  if (existing) {
    await db.update(flEnrolments).set({ status: "enrolled", profile, consentVersion: CONSENT_VERSION, enrolledBy: principal.userId, enrolledAt: new Date(), withdrawnBy: null, withdrawnAt: null }).where(eq(flEnrolments.id, existing.id));
  } else {
    await db.insert(flEnrolments).values({ programmeId: programme.id, orgId, participantRef: `P-${randomBytes(3).toString("hex")}`, status: "enrolled", profile, consentVersion: CONSENT_VERSION, enrolledBy: principal.userId });
  }
  await audit({ actorId: principal.userId, action: "write", subjectType: "fl_enrolment", subjectId: programme.id, orgId, allowed: true, reason: "organisation enrolled in federated programme", detail: { consentVersion: CONSENT_VERSION } });
}

export async function withdraw(db: Db, principal: Principal, audit: AuditSink) {
  const orgId = await requireClientAdmin(principal, audit, "fl_programme");
  const programme = await programmeRow(db);
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(flEnrolments).where(and(eq(flEnrolments.programmeId, programme.id), eq(flEnrolments.orgId, orgId))).for("update");
    if (!e || e.status !== "enrolled") throw new FederatedError("not_enrolled", "this organisation is not enrolled");
    await tx.update(flEnrolments).set({ status: "withdrawn", withdrawnBy: principal.userId, withdrawnAt: new Date() }).where(eq(flEnrolments.id, e.id));
    // Honest consequence: models this participant contributed to are flagged for human review. They are not untrained.
    const flagged = await tx.update(flModelVersions).set({
      needsReview: true,
      needsReviewReason: "A contributing participant withdrew. Withdrawal stops future participation; it does not remove that participant's influence from this model. Re-run without them and compare before relying on it.",
    }).where(and(
      eq(flModelVersions.programmeId, programme.id),
      // Superseded models count too: a rollback could bring one back into use.
      inArray(flModelVersions.status, ["candidate", "approved", "deployed", "superseded"]),
      sql`${flModelVersions.contributorRefs} @> ${JSON.stringify([e.participantRef])}::jsonb`,
    )).returning({ id: flModelVersions.id });
    await audit({ actorId: principal.userId, action: "write", subjectType: "fl_enrolment", subjectId: programme.id, orgId, allowed: true, reason: "organisation withdrew from federated programme", detail: { modelsFlaggedForReview: flagged.length } });
    return { flaggedModels: flagged.length };
  });
}

/**
 * What a client member sees: the programme, their own participation and their own per-round outcomes, and the
 * metrics of the DEPLOYED model only. No other participant's record, no candidate, no weights.
 */
export async function clientView(db: Db, principal: Principal) {
  if (!isClientRole(principal) || !principal.activeOrgId || principal.isEmployee) throw new ForbiddenError({ allow: false, reason: "no active client workspace" });
  const programme = await programmeRow(db);
  const [mine] = await db.select().from(flEnrolments).where(and(eq(flEnrolments.programmeId, programme.id), eq(flEnrolments.orgId, principal.activeOrgId)));

  let history: Array<{ round: number; status: string; reason: string | null; rawNorm: number | null; weight: number | null; runStartedAt: Date }> = [];
  if (mine) {
    history = await db.select({ round: flRounds.round, status: flUpdates.status, reason: flUpdates.reason, rawNorm: flUpdates.rawNorm, weight: flUpdates.weight, runStartedAt: flRuns.startedAt })
      .from(flUpdates).innerJoin(flRounds, eq(flRounds.id, flUpdates.roundId)).innerJoin(flRuns, eq(flRuns.id, flRounds.runId))
      .where(and(eq(flUpdates.participantRef, mine.participantRef), eq(flRuns.programmeId, programme.id)))
      .orderBy(desc(flRuns.startedAt), asc(flRounds.round)).limit(60);
  }
  const [deployed] = await db.select({ label: flModelVersions.label, metrics: flModelVersions.metrics }).from(flModelVersions)
    .where(and(eq(flModelVersions.programmeId, programme.id), eq(flModelVersions.status, "deployed"))).limit(1);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(flEnrolments).where(and(eq(flEnrolments.programmeId, programme.id), eq(flEnrolments.status, "enrolled")));

  return {
    programme: { name: programme.name, description: programme.description, schemaVersion: programme.schemaVersion, minCohort: programme.minCohort },
    // A participant count is shown only at or above the minimum cohort, so a small count cannot identify who is in.
    participatingOrganisations: n >= programme.minCohort ? n : null,
    canManage: principal.activeRole === "client_admin",
    enrolment: mine ? { status: mine.status, profile: mine.profile, participantRef: mine.participantRef, enrolledAt: mine.enrolledAt, withdrawnAt: mine.withdrawnAt } : null,
    history,
    deployedModel: deployed ? { label: deployed.label, final: (deployed.metrics as { final: EvalReport }).final } : null,
    consent: CONSENT_STATEMENTS,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Coordinators: run rounds and register candidates. Approvers: decide. Two separate grants.
// ---------------------------------------------------------------------------------------------------------

const FAULTS = ["dropout", "sign_flip", "scale_up", "wrong_model_version", "wrong_schema", "non_finite"] as const;
const runSchema = z.object({
  rounds: z.number().int().min(1).max(20).optional(),
  method: z.enum(["fedavg", "trimmed_mean"]).optional(),
  weightCap: z.number().min(0.1).max(1).optional(),
  noiseMultiplier: z.number().min(0.3).max(10).nullable().optional(),
  faults: z.array(z.object({ slot: z.number().int().min(0).max(20), kind: z.enum(FAULTS) })).max(2).default([]),
});

export async function startRun(db: Db, principal: Principal, audit: AuditSink, raw: unknown) {
  await requirePermission({ principal, audit, subjectType: "fl_programme" }, "coordinate_fl", RES);
  const input = runSchema.parse(raw);
  const programme = await programmeRow(db);

  const active = await db.select({ ref: flEnrolments.participantRef, orgId: flEnrolments.orgId }).from(flEnrolments)
    .where(and(eq(flEnrolments.programmeId, programme.id), eq(flEnrolments.status, "enrolled"))).orderBy(asc(flEnrolments.enrolledAt));
  if (active.length < programme.minCohort) {
    throw new FederatedError("cohort_too_small", `a run needs at least ${programme.minCohort} enrolled organisations; ${active.length} are enrolled`);
  }
  if (input.faults.some((f) => f.slot >= active.length)) throw new FederatedError("illegal_state", "fault slot is outside the enrolled cohort");

  const base = programme.config as Omit<RunConfig, "versionPrefix" | "seed">;
  const runId = randomUUID();
  const [{ n: priorRuns }] = await db.select({ n: sql<number>`count(*)::int` }).from(flRuns).where(eq(flRuns.programmeId, programme.id));
  const label = `seasonality-r${priorRuns + 1}`;
  const config: RunConfig = {
    ...DEFAULT_RUN, ...base, seed: seedFor(runId), versionPrefix: label,
    rounds: input.rounds ?? base.rounds ?? DEFAULT_RUN.rounds,
    agg: {
      ...DEFAULT_AGG, ...(base.agg ?? {}),
      ...(input.method ? { method: input.method } : {}),
      ...(input.weightCap ? { weightCap: input.weightCap } : {}),
      ...(input.noiseMultiplier !== undefined ? { dp: input.noiseMultiplier ? { noiseMultiplier: input.noiseMultiplier } : null } : {}),
      minCohort: Math.max(programme.minCohort, DEFAULT_AGG.minCohort),
    },
  };

  let clients = buildClients(active.map((a) => ({ ref: a.ref, orgId: a.orgId })));
  for (const f of input.faults) clients = clients.map((c, i) => (i === f.slot ? injectFault(c, f.kind as FaultKind) : c));
  const holdout = await holdoutFor(programme.id);
  const result = await runProgramme({ clients, holdout, config, schemaVersion: programme.schemaVersion });
  const alone = await standaloneBaselines(active.map((a) => ({ ref: a.ref, orgId: a.orgId })), holdout, config.local, config.rounds);

  const completed = result.rounds.filter((r) => r.status === "completed");
  const contributors = [...new Set(result.rounds.flatMap((r) => r.participants.filter((p) => p.status === "accepted").map((p) => p.ref)))];
  const injected = input.faults.map((f) => ({ slot: f.slot, ref: active[f.slot].ref, kind: f.kind }));

  const candidateId = await db.transaction(async (tx) => {
    await tx.insert(flRuns).values({ id: runId, programmeId: programme.id, startedBy: principal.userId, config, injectedFaults: injected, baselines: { zero: result.baselineZero, alone }, dp: result.dp });
    for (const r of result.rounds) {
      const [row] = await tx.insert(flRounds).values({
        runId, round: r.round, status: r.status, abandonReason: r.abandonReason ?? null, modelVersionBefore: r.modelVersionBefore,
        modelVersionAfter: r.modelVersionAfter, aggregation: r.aggregation, holdout: r.holdout,
      }).returning({ id: flRounds.id });
      if (r.participants.length) {
        await tx.insert(flUpdates).values(r.participants.map((p) => ({
          roundId: row.id, participantRef: p.ref, status: p.status, reason: p.reason ?? null, nExamples: p.nExamples ?? null,
          rawNorm: p.rawNorm ?? null, clippedNorm: p.clippedNorm ?? null, weight: p.weight ?? null,
        })));
      }
    }
    if (completed.length === 0) return null;
    // A run produces a CANDIDATE. Nothing consumes it until it is approved and deployed by someone else.
    const [deployed] = await tx.select({ id: flModelVersions.id }).from(flModelVersions).where(and(eq(flModelVersions.programmeId, programme.id), eq(flModelVersions.status, "deployed")));
    const [v] = await tx.insert(flModelVersions).values({
      programmeId: programme.id, runId, label: result.finalVersion, weights: result.finalWeights,
      metrics: { final: completed[completed.length - 1].holdout, zero: result.baselineZero, alone, roundsCompleted: completed.length, roundsRequested: config.rounds },
      status: "candidate", parentVersionId: deployed?.id ?? null, contributorRefs: contributors, registeredBy: principal.userId,
    }).returning({ id: flModelVersions.id });
    return v.id;
  });

  await audit({ actorId: principal.userId, action: "coordinate_fl", subjectType: "fl_run", subjectId: runId, orgId: null, allowed: true, reason: "federated run executed", detail: { rounds: config.rounds, completed: completed.length, participants: active.length, injectedFaults: injected.length, candidateId } });
  return { runId, candidateId, roundsCompleted: completed.length, label: result.finalVersion };
}

const decisionSchema = z.object({
  action: z.enum(["approve", "reject", "deploy", "rollback", "clear_review"]),
  note: z.string().trim().max(500).optional(),
});

export async function decide(db: Db, principal: Principal, audit: AuditSink, versionId: string, raw: unknown) {
  await requirePermission({ principal, audit, subjectType: "fl_model_version", subjectId: versionId }, "approve_fl", RES);
  const input = decisionSchema.parse(raw);
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) throw new FederatedError("illegal_state", "unknown model version");

  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(flModelVersions).where(eq(flModelVersions.id, versionId)).for("update");
    if (!v) throw new FederatedError("illegal_state", "unknown model version");
    const record = (action: string) => tx.insert(flDecisions).values({ modelVersionId: v.id, action, decidedBy: principal.userId, note: input.note ?? null });
    const log = (reason: string) => audit({ actorId: principal.userId, action: "approve_fl", subjectType: "fl_model_version", subjectId: v.id, orgId: null, allowed: true, reason, detail: { action: input.action, from: v.status } });
    const refuse = async (reason: string, e: FederatedError | ForbiddenError) => {
      await audit({ actorId: principal.userId, action: "approve_fl", subjectType: "fl_model_version", subjectId: v.id, orgId: null, allowed: false, reason });
      throw e;
    };

    switch (input.action) {
      case "approve": {
        if (v.status !== "candidate") throw new FederatedError("illegal_state", `only a candidate can be approved (this one is ${v.status})`);
        if (v.registeredBy === principal.userId) return refuse("two-person rule: the person who registered a model cannot approve it", new ForbiddenError({ allow: false, reason: "two-person rule: someone other than the registrar must approve" }));
        if (v.needsReview) throw new FederatedError("review_required", "this model is flagged for review; clear the flag with a recorded note first");
        await tx.update(flModelVersions).set({ status: "approved" }).where(eq(flModelVersions.id, v.id));
        await record("approve"); await log("candidate approved");
        return { status: "approved" };
      }
      case "reject": {
        if (v.status !== "candidate" && v.status !== "approved") throw new FederatedError("illegal_state", `cannot reject a model that is ${v.status}`);
        await tx.update(flModelVersions).set({ status: "rejected" }).where(eq(flModelVersions.id, v.id));
        await record("reject"); await log("model rejected");
        return { status: "rejected" };
      }
      case "deploy": {
        if (v.status !== "approved") throw new FederatedError("illegal_state", "only an approved model can be deployed");
        if (v.needsReview) throw new FederatedError("review_required", "this model is flagged for review; clear the flag first");
        await tx.update(flModelVersions).set({ status: "superseded" }).where(and(eq(flModelVersions.programmeId, v.programmeId), eq(flModelVersions.status, "deployed")));
        await tx.update(flModelVersions).set({ status: "deployed" }).where(eq(flModelVersions.id, v.id));
        await record("deploy"); await log("model deployed (registry state only: nothing in this portal serves predictions from it)");
        return { status: "deployed" };
      }
      case "rollback": {
        if (v.status !== "deployed") throw new FederatedError("illegal_state", "only the deployed model can be rolled back");
        await tx.update(flModelVersions).set({ status: "rolled_back" }).where(eq(flModelVersions.id, v.id));
        let restored: string | null = null;
        if (v.parentVersionId) {
          const [parent] = await tx.select().from(flModelVersions).where(eq(flModelVersions.id, v.parentVersionId)).for("update");
          // Only restore a previously approved model that is still fit to use.
          if (parent && parent.status === "superseded" && !parent.needsReview) {
            await tx.update(flModelVersions).set({ status: "deployed" }).where(eq(flModelVersions.id, parent.id));
            restored = parent.id;
          }
        }
        await record("rollback"); await log(restored ? "rolled back to the previous approved model" : "rolled back; no previous model fit to restore, so none is deployed");
        return { status: "rolled_back", restored };
      }
      case "clear_review": {
        if (!v.needsReview) throw new FederatedError("illegal_state", "this model is not flagged for review");
        if (!input.note || input.note.length < 10) throw new FederatedError("review_required", "clearing a review flag needs a recorded note of at least 10 characters");
        await tx.update(flModelVersions).set({ needsReview: false, needsReviewReason: null }).where(eq(flModelVersions.id, v.id));
        await record("clear_review"); await log("review flag cleared with note");
        return { status: v.status };
      }
    }
  });
}

/** The programme as the employee portal shows it. Needs either federated grant; shows what the caller can do. */
export async function employeeOverview(db: Db, principal: Principal, audit: AuditSink) {
  if (!can(principal, "coordinate_fl", RES).allow && !can(principal, "approve_fl", RES).allow) {
    await requirePermission({ principal, audit, subjectType: "fl_programme" }, "coordinate_fl", RES);
  }
  const programme = await programmeRow(db);
  const enrolments = await db.select({ ref: flEnrolments.participantRef, status: flEnrolments.status, profile: flEnrolments.profile, orgName: organizations.name, enrolledAt: flEnrolments.enrolledAt, withdrawnAt: flEnrolments.withdrawnAt })
    .from(flEnrolments).innerJoin(organizations, eq(organizations.id, flEnrolments.orgId)).where(eq(flEnrolments.programmeId, programme.id)).orderBy(asc(flEnrolments.enrolledAt));
  const runs = await db.select().from(flRuns).where(eq(flRuns.programmeId, programme.id)).orderBy(desc(flRuns.startedAt)).limit(4);
  const runIds = runs.map((r) => r.id);
  const rounds = runIds.length ? await db.select().from(flRounds).where(inArray(flRounds.runId, runIds)).orderBy(asc(flRounds.round)) : [];
  const updates = rounds.length ? await db.select().from(flUpdates).where(inArray(flUpdates.roundId, rounds.map((r) => r.id))) : [];
  const versions = await db.select({
    id: flModelVersions.id, label: flModelVersions.label, status: flModelVersions.status, metrics: flModelVersions.metrics, needsReview: flModelVersions.needsReview,
    needsReviewReason: flModelVersions.needsReviewReason, registeredBy: flModelVersions.registeredBy, createdAt: flModelVersions.createdAt, runId: flModelVersions.runId,
    contributorRefs: flModelVersions.contributorRefs,
  }).from(flModelVersions).where(eq(flModelVersions.programmeId, programme.id)).orderBy(desc(flModelVersions.createdAt)).limit(12);
  const decisions = versions.length ? await db.select().from(flDecisions).where(inArray(flDecisions.modelVersionId, versions.map((v) => v.id))).orderBy(asc(flDecisions.at)) : [];

  return {
    programme: { id: programme.id, name: programme.name, description: programme.description, schemaVersion: programme.schemaVersion, minCohort: programme.minCohort },
    canCoordinate: can(principal, "coordinate_fl", RES).allow,
    canApprove: can(principal, "approve_fl", RES).allow,
    userId: principal.userId,
    enrolments,
    runs: runs.map((r) => ({
      id: r.id, startedAt: r.startedAt, injectedFaults: r.injectedFaults as Array<{ slot: number; ref: string; kind: FaultKind }>,
      baselines: r.baselines as { zero: EvalReport; alone: Record<string, EvalReport> }, dp: r.dp as DpReport | null, config: r.config as RunConfig,
      rounds: rounds.filter((x) => x.runId === r.id).map((x) => ({ ...x, updates: updates.filter((u) => u.roundId === x.id) })),
    })),
    versions: versions.map((v) => ({ ...v, decisions: decisions.filter((d) => d.modelVersionId === v.id) })),
  };
}
