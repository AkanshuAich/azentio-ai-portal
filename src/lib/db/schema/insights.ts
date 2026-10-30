import { pgTable, uuid, text, timestamp, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organizations, users } from "./identity";
import { contributions, improvementIdeas, sharedPublications } from "./learning";

// The moderator's working copy: reviewed fields only. It is separate from the private source, and a
// publication is created FROM it, so hidden source metadata can never leak into the shared copy.
export const reviewDrafts = pgTable("review_drafts", {
  contributionId: uuid("contribution_id").primaryKey().references(() => contributions.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  offering: text("offering").notNull(),
  industry: text("industry"),
  region: text("region"),
  observationPeriod: text("observation_period"),
  evidenceType: text("evidence_type"),
  confidence: text("confidence"),
  attribution: text("attribution").notNull().default("anonymous"),
  evidenceQuality: text("evidence_quality"),
  topic: text("topic"),
  updatedBy: uuid("updated_by").notNull().references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// What the AUTHOR sees as the status history: public reasons only, never reviewer notes.
export const contributionEvents = pgTable(
  "contribution_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionId: uuid("contribution_id").notNull().references(() => contributions.id),
    actorType: text("actor_type").notNull(), // author | moderator | system
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    note: text("note"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contribution_events_contrib").on(t.contributionId)],
);

export const ideaEvidence = pgTable(
  "idea_evidence",
  {
    ideaId: uuid("idea_id").notNull().references(() => improvementIdeas.id),
    publicationId: uuid("publication_id").notNull().references(() => sharedPublications.id),
  },
  (t) => [uniqueIndex("idea_evidence_pk").on(t.ideaId, t.publicationId)],
);

// Quality feedback on a shared item. One per person; no counts are used for ranking or leaderboards.
export const publicationFeedback = pgTable(
  "publication_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicationId: uuid("publication_id").notNull().references(() => sharedPublications.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    value: text("value").notNull(), // useful | needs_evidence
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("publication_feedback_pk").on(t.publicationId, t.userId)],
);

export const savedSearches = pgTable("saved_searches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  query: jsonb("query").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Retrieval chunks for AIRA, built ONLY from approved shared text. Deleted on withdrawal.
export const airaChunks = pgTable("aira_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicationId: uuid("publication_id").notNull().references(() => sharedPublications.id),
  text: text("text").notNull(),
});

// Tiny key/value state. `feed_epoch` is bumped on every publish/withdraw so cached feed aggregates expire.
export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});
