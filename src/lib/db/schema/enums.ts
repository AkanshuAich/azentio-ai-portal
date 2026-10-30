import { pgEnum } from "drizzle-orm/pg-core";

export const orgKind = pgEnum("org_kind", ["azentio", "client"]);

// Role within one membership. Platform capabilities are NOT roles: they are separate grants (IAM-02).
export const membershipRole = pgEnum("membership_role", [
  "employee",
  "client_member",
  "client_admin",
]);
export const membershipStatus = pgEnum("membership_status", ["invited", "active", "revoked"]);

export const permission = pgEnum("permission", [
  "learning.moderate",
  "media.publish",
  "members.invite",
  "roles.grant",
  "ideas.manage",
  "platform.administer",
  "support.access_private",
  "federated.coordinate",
  "federated.approve",
]);

// No default anywhere this is used: a row without audience metadata must be denied, not public.
export const audienceKind = pgEnum("audience_kind", [
  "public",
  "employee",
  "tenant",
  "tenant_private",
  "shared_community",
  "entitled",
]);

export const contributionStatus = pgEnum("contribution_status", [
  "draft",
  "submitted",
  "in_review",
  "returned",
  "rejected",
  "approved",
  "published",
  "unpublished_under_review",
  "withdrawn",
]);
export const sharingChoice = pgEnum("sharing_choice", ["private", "organisation", "propose_shared"]);
export const attributionMode = pgEnum("attribution_mode", ["anonymous", "organisation"]);
export const consentKind = pgEnum("consent_kind", [
  "store_process",
  "publish_shared",
  "attribution",
  "model_training",
]);
export const ideaStatus = pgEnum("idea_status", [
  "proposed",
  "under_review",
  "planned",
  "in_progress",
  "released",
  "not_proceeding",
]);
