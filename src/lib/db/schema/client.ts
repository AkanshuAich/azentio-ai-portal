import {
  pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./identity";

export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    // The workspace the bookmark was made in, so it never surfaces in another workspace.
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bookmarks_user_resource").on(t.userId, t.resourceType, t.resourceId)],
);

// A comment inherits its parent's audience. orgId is the tenant the comment lives in: readers must be
// able to read the parent AND belong to that tenant (or hold the moderation grant).
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentType: text("parent_type").notNull(),
    parentId: uuid("parent_id").notNull(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    authorId: uuid("author_id").notNull().references(() => users.id),
    body: text("body").notNull(),
    status: text("status").notNull().default("visible"), // visible | hidden
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_parent").on(t.parentType, t.parentId)],
);

export const commentReports = pgTable("comment_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  commentId: uuid("comment_id").notNull().references(() => comments.id),
  reporterId: uuid("reporter_id").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Saved sandbox scenarios, isolated by tenant and author. 'organisation' shares with the author's own org only.
export const savedScenarios = pgTable(
  "saved_scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    scenarioId: text("scenario_id").notNull(),
    params: jsonb("params").notNull(),
    visibility: text("visibility").notNull().default("private"), // private | organisation
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_scenarios_org").on(t.orgId)],
);

// Support requests are recorded here. This is NOT a live service-desk integration (see docs).
export const supportRequests = pgTable("support_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("recorded"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
