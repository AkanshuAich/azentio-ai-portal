// Mirrors the Postgres enums so the policy engine stays pure and testable without a database.

export type AudienceKind =
  | "public"
  | "employee"
  | "tenant"
  | "tenant_private"
  | "shared_community"
  | "entitled";

export const AUDIENCE_KINDS: readonly AudienceKind[] = [
  "public",
  "employee",
  "tenant",
  "tenant_private",
  "shared_community",
  "entitled",
];

export type MembershipRole = "employee" | "client_member" | "client_admin";
export type MembershipStatus = "invited" | "active" | "revoked";

// Separate grants (IAM-02): employee status implies none of these.
export type Permission =
  | "learning.moderate"
  | "media.publish"
  | "members.invite"
  | "roles.grant"
  | "ideas.manage"
  | "platform.administer"
  | "support.access_private"
  | "federated.coordinate"
  | "federated.approve";

export type Action =
  | "read"
  | "write"
  | "moderate"
  | "publish_media"
  | "invite_member"
  | "grant_role"
  | "manage_ideas"
  | "administer"
  | "access_private"
  | "coordinate_fl"
  | "approve_fl";

export interface MembershipRecord {
  orgId: string;
  orgKind: "azentio" | "client";
  role: MembershipRole;
  status: MembershipStatus;
  /** Set when an organiser approved an employee membership. */
  approvedBy: string | null;
}

export interface GrantRecord {
  permission: Permission;
  expiresAt: Date | null;
}

/** Everything the server knows about the caller. Built from the session row, never from request input. */
export interface PrincipalInput {
  userId: string;
  email: string;
  emailVerified: boolean;
  memberships: MembershipRecord[];
  grants: GrantRecord[];
  /** Taken from the session record. Re-validated against memberships in buildPrincipal. */
  sessionActiveOrgId: string | null;
  /** Product slugs the active organisation is entitled to. */
  entitlements: string[];
  now?: Date;
}

export interface Principal {
  userId: string;
  isEmployee: boolean;
  /** Active organisation, only if the caller holds a valid active membership in it. */
  activeOrgId: string | null;
  activeRole: MembershipRole | null;
  permissions: ReadonlySet<Permission>;
  entitlements: ReadonlySet<string>;
}

/** A protected resource. `audience` is deliberately nullable at the type level so missing metadata is testable. */
export interface Resource {
  audience: AudienceKind | null | undefined;
  /** Owning tenant for tenant-scoped audiences. */
  orgId?: string | null;
  /** Author, for tenant_private resources. */
  ownerId?: string | null;
  /** Product slug required for `entitled` resources. */
  entitlement?: string | null;
  /** For grant_role: the role being granted. */
  targetRole?: MembershipRole | "moderator" | "publisher" | "portal_admin" | null;
}

export interface Decision {
  allow: boolean;
  reason: string;
}
