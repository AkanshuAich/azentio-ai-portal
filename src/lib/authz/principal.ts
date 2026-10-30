import type { Permission, Principal, PrincipalInput } from "./types";

const EMPLOYEE_DOMAIN = "@azentio.com";

/**
 * Assemble the caller's authority from server-side records only.
 *
 * An employee needs ALL of: a verified identity, an @azentio.com address, and an active,
 * organiser-approved membership in the Azentio organisation. The email suffix alone never
 * confers employee status (IAM-01).
 */
export function buildPrincipal(input: PrincipalInput): Principal {
  const now = input.now ?? new Date();

  const isEmployee =
    input.emailVerified &&
    input.email.toLowerCase().endsWith(EMPLOYEE_DOMAIN) &&
    input.memberships.some(
      (m) =>
        m.orgKind === "azentio" &&
        m.role === "employee" &&
        m.status === "active" &&
        m.approvedBy !== null,
    );

  // The session may name an active org, but it only counts if a valid active membership backs it.
  const active = input.sessionActiveOrgId
    ? input.memberships.find(
        (m) => m.orgId === input.sessionActiveOrgId && m.status === "active",
      )
    : undefined;

  const permissions = new Set<Permission>();
  for (const g of input.grants) {
    if (g.expiresAt && g.expiresAt <= now) continue; // expired grants confer nothing
    permissions.add(g.permission);
  }

  // Grants held by someone who is not a verified employee are inert.
  if (!isEmployee) permissions.clear();

  return {
    userId: input.userId,
    isEmployee,
    activeOrgId: active ? active.orgId : null,
    activeRole: active ? active.role : null,
    permissions,
    // Entitlements belong to the active org; without a valid active membership there are none.
    entitlements: new Set(active ? input.entitlements : []),
  };
}
