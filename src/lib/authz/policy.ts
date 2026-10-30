import { AUDIENCE_KINDS } from "./types";
import type { Action, Decision, Permission, Principal, Resource } from "./types";

const allow = (reason: string): Decision => ({ allow: true, reason });
const deny = (reason: string): Decision => ({ allow: false, reason });

/** Roles only a platform-level `roles.grant` holder may hand out. A client administrator never can. */
const RESTRICTED_TARGET_ROLES = new Set(["employee", "moderator", "publisher", "portal_admin"]);
const CLIENT_TARGET_ROLES = new Set(["client_member", "client_admin"]);

/** Actions that need an explicit platform permission held by a verified employee (IAM-02). */
const PERMISSION_FOR_ACTION: Partial<Record<Action, Permission>> = {
  moderate: "learning.moderate",
  publish_media: "media.publish",
  manage_ideas: "ideas.manage",
  administer: "platform.administer",
  access_private: "support.access_private",
};

function hasPlatformPermission(p: Principal, perm: Permission): boolean {
  return p.isEmployee && p.permissions.has(perm);
}

function isClientRole(p: Principal): boolean {
  return p.activeRole === "client_member" || p.activeRole === "client_admin";
}

function tenantMatches(p: Principal, r: Resource): boolean {
  return Boolean(p.activeOrgId && r.orgId && p.activeOrgId === r.orgId);
}

/** Condition 1 and 2 of the required access rule, for reading a resource. */
function audiencePermits(p: Principal | null, r: Resource): Decision {
  if (!r.audience || !AUDIENCE_KINDS.includes(r.audience)) {
    // Public is explicit; it is never the fallback for missing metadata.
    return deny("resource has no valid audience metadata");
  }
  if (r.audience === "public") return allow("public resource");
  if (!p) return deny("authentication required");

  switch (r.audience) {
    case "employee":
      return p.isEmployee ? allow("employee audience") : deny("employee-only resource");
    case "shared_community":
      return p.isEmployee || isClientRole(p)
        ? allow("authorised learning participant")
        : deny("not an authorised learning participant");
    case "tenant":
      return tenantMatches(p, r) ? allow("active tenant matches") : deny("tenant mismatch");
    case "tenant_private":
      if (!tenantMatches(p, r)) return deny("tenant mismatch");
      return r.ownerId && r.ownerId === p.userId
        ? allow("owner of private record")
        : deny("private to its author");
    case "entitled":
      // Entitled content is shared by product, so it has no owning tenant. The caller needs a valid client
      // workspace and the entitlement; if the record does name a tenant, it must be the active one.
      if (!p.activeOrgId || !isClientRole(p)) return deny("no active client workspace");
      if (r.orgId && r.orgId !== p.activeOrgId) return deny("tenant mismatch");
      if (!r.entitlement) return deny("entitled resource names no product");
      return p.entitlements.has(r.entitlement)
        ? allow("tenant is entitled")
        : deny("tenant lacks product entitlement");
    default:
      return deny("unknown audience");
  }
}

/**
 * The single decision point: an authenticated user may act on a resource only when its audience
 * permits their identity, their active tenant/membership is valid where applicable, and the
 * action is authorised. Anything not explicitly allowed is denied.
 */
export function can(principal: Principal | null, action: Action, resource: Resource): Decision {
  const required = PERMISSION_FOR_ACTION[action];
  if (required) {
    if (!principal) return deny("authentication required");
    if (!hasPlatformPermission(principal, required)) return deny(`missing grant: ${required}`);
    if (action === "access_private") {
      const tenantScoped =
        resource.audience === "tenant" ||
        resource.audience === "tenant_private" ||
        resource.audience === "entitled";
      return tenantScoped && resource.orgId
        ? allow("explicit support/moderation authorisation")
        : deny("access_private applies only to tenant-scoped resources");
    }
    return allow(`granted: ${required}`);
  }

  switch (action) {
    case "read":
      return audiencePermits(principal, resource);

    case "write": {
      const readable = audiencePermits(principal, resource);
      if (!readable.allow) return readable;
      switch (resource.audience) {
        case "public":
          // Public content is changed only through the publishing console.
          return principal && (hasPlatformPermission(principal, "media.publish") ||
            hasPlatformPermission(principal, "platform.administer"))
            ? allow("publisher")
            : deny("public content is read-only without a publishing grant");
        case "employee":
          return allow("employee audience");
        case "shared_community":
          return deny("shared content changes only through moderated publication");
        default:
          return principal && isClientRole(principal) && tenantMatches(principal, resource)
            ? allow("member of active tenant")
            : deny("write requires a client role in the active tenant");
      }
    }

    case "invite_member": {
      if (!principal) return deny("authentication required");
      if (hasPlatformPermission(principal, "members.invite")) return allow("granted: members.invite");
      return principal.activeRole === "client_admin" && tenantMatches(principal, resource)
        ? allow("client administrator of own organisation")
        : deny("not permitted to invite into this organisation");
    }

    case "grant_role": {
      if (!principal) return deny("authentication required");
      const target = resource.targetRole;
      if (!target) return deny("no target role named");
      if (RESTRICTED_TARGET_ROLES.has(target)) {
        return hasPlatformPermission(principal, "roles.grant")
          ? allow("granted: roles.grant")
          : deny("platform roles can only be granted with roles.grant");
      }
      if (CLIENT_TARGET_ROLES.has(target)) {
        if (hasPlatformPermission(principal, "roles.grant")) return allow("granted: roles.grant");
        return principal.activeRole === "client_admin" && tenantMatches(principal, resource)
          ? allow("client administrator of own organisation")
          : deny("not permitted to grant roles in this organisation");
      }
      return deny("unknown target role");
    }

    default:
      return deny("unknown action");
  }
}
