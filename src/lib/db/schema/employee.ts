import {
  pgTable, uuid, text, timestamp, boolean, jsonb, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { audienceKind } from "./enums";
import { organizations, users } from "./identity";
import { knowledgeArticles } from "./content";

export const experiments = pgTable("experiments", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  hypothesis: text("hypothesis").notNull(),
  expectedOutcome: text("expected_outcome"),
  status: text("status").notNull().default("proposed"), // proposed | running | concluded
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  audience: audienceKind("audience").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hackathonTeams = pgTable("hackathon_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  audience: audienceKind("audience").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hackathonTeamMembers = pgTable(
  "hackathon_team_members",
  {
    teamId: uuid("team_id").notNull().references(() => hackathonTeams.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("hackathon_team_members_pk").on(t.teamId, t.userId)],
);

// Synthetic sandbox runs. orgId is null for employee runs; client sandboxes (Phase 4) set it for tenant isolation.
export const playgroundRuns = pgTable(
  "playground_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    orgId: uuid("org_id").references(() => organizations.id),
    scenarioId: text("scenario_id").notNull(),
    params: jsonb("params").notNull(),
    output: jsonb("output").notNull(),
    feedback: jsonb("feedback"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("playground_runs_user").on(t.userId)],
);

export const knowledgeFeedback = pgTable(
  "knowledge_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id").notNull().references(() => knowledgeArticles.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    useful: boolean("useful").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("knowledge_feedback_article_user").on(t.articleId, t.userId)],
);

// Homepage banner, managed only through the publishing console.
export const siteBanners = pgTable("site_banners", {
  id: uuid("id").primaryKey().defaultRandom(),
  message: text("message").notNull(),
  href: text("href"),
  active: boolean("active").notNull().default(false),
  audience: audienceKind("audience").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
