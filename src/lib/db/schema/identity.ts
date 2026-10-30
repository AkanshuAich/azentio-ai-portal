import {
  pgTable, uuid, text, timestamp, boolean, uniqueIndex, index, jsonb,
} from "drizzle-orm/pg-core";
import { orgKind, membershipRole, membershipStatus, permission } from "./enums";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: orgKind("kind").notNull(),
  name: text("name").notNull(),
  industry: text("industry"),
  region: text("region"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  // Set only after a real email-code/magic-link verification, never from the email suffix.
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A user may hold several memberships; the session names exactly one as active.
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    role: membershipRole("role").notNull(),
    status: membershipStatus("status").notNull(),
    // Employee memberships need organiser approval on top of a verified @azentio.com identity.
    approvedBy: uuid("approved_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memberships_user_org").on(t.userId, t.orgId)],
);

// One row per grant, so publish / moderate / invite / grant-roles stay independent (IAM-02).
export const platformGrants = pgTable(
  "platform_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    permission: permission("permission").notNull(),
    grantedBy: uuid("granted_by").references(() => users.id),
    // support.access_private must be time-boxed and carry a reason.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_grants_user_perm").on(t.userId, t.permission)],
);

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  email: text("email").notNull(),
  proposedRole: membershipRole("proposed_role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  activeOrgId: uuid("active_org_id").references(() => organizations.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    productSlug: text("product_slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("entitlements_org_product").on(t.orgId, t.productSlug)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    orgId: uuid("org_id"),
    allowed: boolean("allowed").notNull(),
    detail: jsonb("detail"),
  },
  (t) => [index("audit_events_actor").on(t.actorId), index("audit_events_org").on(t.orgId)],
);
