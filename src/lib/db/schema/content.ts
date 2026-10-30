import { pgTable, uuid, text, timestamp, date, integer } from "drizzle-orm/pg-core";
import { audienceKind } from "./enums";
import { organizations } from "./identity";

// Every protected row carries a non-null audience with no default, so missing metadata cannot read as public.
export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  summary: text("summary").notNull(),
  audience: audienceKind("audience").notNull(),
});

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  storageKey: text("storage_key").notNull(),
  audience: audienceKind("audience").notNull(),
  ownerOrgId: uuid("owner_org_id").references(() => organizations.id),
  productSlug: text("product_slug"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const liveSessions = pgTable("live_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  streamRef: text("stream_ref"),
  audience: audienceKind("audience").notNull(),
  ownerOrgId: uuid("owner_org_id").references(() => organizations.id),
});

export const knowledgeArticles = pgTable("knowledge_articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  ownerName: text("owner_name").notNull(),
  reviewDate: date("review_date").notNull(),
  audience: audienceKind("audience").notNull(),
});

export const releaseNotes = pgTable("release_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audience: audienceKind("audience").notNull(),
  ownerOrgId: uuid("owner_org_id").references(() => organizations.id),
  version: integer("version").notNull().default(1),
});
