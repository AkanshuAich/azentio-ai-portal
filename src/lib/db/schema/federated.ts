import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./identity";

// Federated programme (P2). SYNTHETIC data only. Nothing here stores a client example, a label or a weight
// delta: the coordinator's persisted record is metadata (who took part, how, with what outcome) plus the
// aggregated model, which is exactly what the coordinator legitimately holds.

export const flProgrammes = pgTable("fl_programmes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  schemaVersion: text("schema_version").notNull(),
  // The smallest number of enrolled organisations at which a run is allowed to start.
  minCohort: integer("min_cohort").notNull(),
  config: jsonb("config").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A client's participation. It is the client administrator's decision, per organisation, and reversible.
export const flEnrolments = pgTable(
  "fl_enrolments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programmeId: uuid("programme_id").notNull().references(() => flProgrammes.id),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    // Pseudonymous reference used in every coordinator log. Never the organisation name or id.
    participantRef: text("participant_ref").notNull(),
    status: text("status").notNull(), // enrolled | withdrawn
    // Which synthetic dataset profile this simulated client holds.
    profile: text("profile").notNull(),
    consentVersion: text("consent_version").notNull(),
    enrolledBy: uuid("enrolled_by").notNull().references(() => users.id),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnBy: uuid("withdrawn_by").references(() => users.id),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("fl_enrolments_programme_org").on(t.programmeId, t.orgId),
    uniqueIndex("fl_enrolments_ref").on(t.programmeId, t.participantRef),
  ],
);

export const flRuns = pgTable("fl_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  programmeId: uuid("programme_id").notNull().references(() => flProgrammes.id),
  startedBy: uuid("started_by").notNull().references(() => users.id),
  config: jsonb("config").notNull(),
  // Faults deliberately injected for the demonstration; shown with an explicit label wherever the run appears.
  injectedFaults: jsonb("injected_faults").notNull(),
  // Baselines on the holdout: the untrained model and each client trained alone (by pseudonymous ref).
  baselines: jsonb("baselines").notNull(),
  dp: jsonb("dp"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
});

export const flRounds = pgTable(
  "fl_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => flRuns.id),
    round: integer("round").notNull(),
    status: text("status").notNull(), // completed | abandoned
    abandonReason: text("abandon_reason"),
    modelVersionBefore: text("model_version_before").notNull(),
    modelVersionAfter: text("model_version_after").notNull(),
    aggregation: jsonb("aggregation"),
    holdout: jsonb("holdout").notNull(),
  },
  (t) => [uniqueIndex("fl_rounds_run_round").on(t.runId, t.round)],
);

// Per-participant outcome of one round. Metadata only: no delta vector, no example, no organisation id.
export const flUpdates = pgTable(
  "fl_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id").notNull().references(() => flRounds.id),
    participantRef: text("participant_ref").notNull(),
    status: text("status").notNull(), // accepted | rejected | dropped
    reason: text("reason"),
    nExamples: integer("n_examples"),
    rawNorm: doublePrecision("raw_norm"),
    clippedNorm: doublePrecision("clipped_norm"),
    weight: doublePrecision("weight"),
  },
  (t) => [index("fl_updates_round").on(t.roundId)],
);

// The candidate registry. A model produced by a run is a CANDIDATE and is never used by anything until a
// person with the approval grant, other than the person who registered it, approves and then deploys it.
export const flModelVersions = pgTable(
  "fl_model_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programmeId: uuid("programme_id").notNull().references(() => flProgrammes.id),
    runId: uuid("run_id").notNull().references(() => flRuns.id),
    label: text("label").notNull(),
    weights: jsonb("weights").notNull(),
    metrics: jsonb("metrics").notNull(),
    // candidate | approved | deployed | rejected | rolled_back | superseded
    status: text("status").notNull(),
    // The deployed model this candidate would replace, for rollback lineage.
    parentVersionId: uuid("parent_version_id"),
    // Pseudonymous references of participants whose accepted updates went into this model.
    contributorRefs: jsonb("contributor_refs").notNull(),
    needsReview: boolean("needs_review").notNull().default(false),
    needsReviewReason: text("needs_review_reason"),
    registeredBy: uuid("registered_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fl_model_versions_programme").on(t.programmeId, t.createdAt)],
);

export const flDecisions = pgTable("fl_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  modelVersionId: uuid("model_version_id").notNull().references(() => flModelVersions.id),
  action: text("action").notNull(), // approve | reject | deploy | rollback | clear_review
  decidedBy: uuid("decided_by").notNull().references(() => users.id),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
