import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  contributionStatus, sharingChoice, attributionMode, consentKind, ideaStatus,
} from "./enums";
import { organizations, users } from "./identity";

// The private SOURCE record. It never leaves the author's organisation or the moderation boundary.
export const contributions = pgTable(
  "contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    authorId: uuid("author_id").notNull().references(() => users.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    offering: text("offering").notNull(),
    industry: text("industry"),
    region: text("region"),
    observationPeriod: text("observation_period"),
    evidenceType: text("evidence_type"),
    confidence: text("confidence"),
    sharingChoice: sharingChoice("sharing_choice").notNull().default("private"),
    status: contributionStatus("status").notNull().default("draft"),
    sensitiveFlags: jsonb("sensitive_flags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contributions_org").on(t.orgId)],
);

// The approved SHARED representation: separate table, reviewed fields only, no source metadata/attachments.
export const sharedPublications = pgTable(
  "shared_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionId: uuid("contribution_id").notNull().references(() => contributions.id),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    body: text("body").notNull(),
    offering: text("offering").notNull(),
    industry: text("industry"),
    region: text("region"),
    observationPeriod: text("observation_period"),
    evidenceType: text("evidence_type"),
    confidence: text("confidence"),
    attribution: attributionMode("attribution").notNull().default("anonymous"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("shared_pub_contrib_version").on(t.contributionId, t.version)],
);

export const moderationActions = pgTable("moderation_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  contributionId: uuid("contribution_id").notNull().references(() => contributions.id),
  moderatorId: uuid("moderator_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  publicReason: text("public_reason"),
  privateNotes: text("private_notes"), // internal reviewer notes: never in a shared payload
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const contributionReports = pgTable("contribution_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicationId: uuid("publication_id").notNull().references(() => sharedPublications.id),
  reporterId: uuid("reporter_id").notNull().references(() => users.id), // never disclosed to the author
  reason: text("reason").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// Four independent permissions: membership, publishing and model training are not interchangeable.
export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  contributionId: uuid("contribution_id").notNull().references(() => contributions.id),
  kind: consentKind("kind").notNull(),
  granted: boolean("granted").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  offering: text("offering").notNull(),
  limitations: text("limitations"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const themeEvidence = pgTable(
  "theme_evidence",
  {
    themeId: uuid("theme_id").notNull().references(() => themes.id),
    publicationId: uuid("publication_id").notNull().references(() => sharedPublications.id),
  },
  (t) => [uniqueIndex("theme_evidence_pk").on(t.themeId, t.publicationId)],
);

export const improvementIdeas = pgTable("improvement_ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  problem: text("problem").notNull(),
  offering: text("offering").notNull(),
  proposedOutcome: text("proposed_outcome"),
  ownerTeam: text("owner_team").notNull(),
  // The assigned product owner. Assignment grants access only to evidence shared for that purpose.
  ownerUserId: uuid("owner_user_id").references(() => users.id),
  priority: text("priority"),
  status: ideaStatus("status").notNull().default("proposed"),
  themeId: uuid("theme_id").references(() => themes.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// Persisted outbox with an idempotency key; "queued" is never presented as "delivered".
export const outboxMessages = pgTable("outbox_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  toUserId: uuid("to_user_id").references(() => users.id),
  toEmail: text("to_email"),
  subject: text("subject"),
  // Secret-bearing bodies (sign-in codes, invitation links) are redacted once handed to a real transport.
  body: text("body"),
  channel: text("channel").notNull().default("email"),
  // queued -> dev_logged | sent. "sent" means handed to a provider, never "delivered".
  state: text("state").notNull().default("queued"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const searchDocuments = pgTable("search_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicationId: uuid("publication_id").notNull().references(() => sharedPublications.id),
  text: text("text").notNull(),
});
