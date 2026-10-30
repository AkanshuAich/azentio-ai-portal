import { describe, it, expect } from "vitest";
import { buildPrincipal } from "@/lib/authz/principal";
import { can } from "@/lib/authz/policy";
import { requirePermission, ForbiddenError, type AuditRecord } from "@/lib/authz/guard";
import type {
  GrantRecord, MembershipRecord, Permission, Principal, Resource,
} from "@/lib/authz/types";

const AZ = "org-azentio";
const MERIDIAN = "org-meridian";
const NUSANTARA = "org-nusantara";

function employee(grants: Permission[] = [], over: Partial<{ approved: boolean; verified: boolean; email: string }> = {}): Principal {
  const g: GrantRecord[] = grants.map((permission) => ({ permission, expiresAt: null }));
  const m: MembershipRecord = {
    orgId: AZ, orgKind: "azentio", role: "employee", status: "active",
    approvedBy: over.approved === false ? null : "organiser",
  };
  return buildPrincipal({
    userId: "emp-1", email: over.email ?? "dev@azentio.com",
    emailVerified: over.verified ?? true,
    memberships: [m], grants: g, sessionActiveOrgId: AZ, entitlements: [],
  });
}

function client(orgId: string, role: "client_member" | "client_admin", userId = "cli-1", entitlements: string[] = []): Principal {
  return buildPrincipal({
    userId, email: `${userId}@bank.example`, emailVerified: true,
    memberships: [{ orgId, orgKind: "client", role, status: "active", approvedBy: null }],
    grants: [], sessionActiveOrgId: orgId, entitlements,
  });
}

const res = (r: Partial<Resource> & Pick<Resource, "audience">): Resource => r;

describe("IAM-01: authority is server-derived", () => {
  it("an @azentio.com address without an approved employee membership is not an employee", () => {
    expect(employee([], { approved: false }).isEmployee).toBe(false);
  });

  it("an unverified identity is not an employee even with the right suffix and membership", () => {
    expect(employee([], { verified: false }).isEmployee).toBe(false);
  });

  it("an external email cannot become an employee", () => {
    expect(employee([], { email: "dev@evil-azentio.com" }).isEmployee).toBe(false);
  });

  it("a session naming an org the user has no active membership in yields no active tenant", () => {
    const p = buildPrincipal({
      userId: "u", email: "u@bank.example", emailVerified: true,
      memberships: [{ orgId: MERIDIAN, orgKind: "client", role: "client_member", status: "active", approvedBy: null }],
      grants: [], sessionActiveOrgId: NUSANTARA, entitlements: ["x"],
    });
    expect(p.activeOrgId).toBeNull();
    expect(p.entitlements.size).toBe(0);
    expect(can(p, "read", res({ audience: "tenant", orgId: NUSANTARA })).allow).toBe(false);
  });

  it("a revoked membership confers no active tenant", () => {
    const p = buildPrincipal({
      userId: "u", email: "u@bank.example", emailVerified: true,
      memberships: [{ orgId: MERIDIAN, orgKind: "client", role: "client_admin", status: "revoked", approvedBy: null }],
      grants: [], sessionActiveOrgId: MERIDIAN, entitlements: [],
    });
    expect(p.activeOrgId).toBeNull();
  });

  it("cross-tenant read is denied: a Meridian member cannot read a Nusantara record", () => {
    const p = client(MERIDIAN, "client_admin");
    expect(can(p, "read", res({ audience: "tenant", orgId: NUSANTARA })).allow).toBe(false);
    expect(can(p, "read", res({ audience: "tenant", orgId: MERIDIAN })).allow).toBe(true);
  });
});

describe("IAM-02: least privilege, separate grants", () => {
  const privileged: Array<[Permission, Parameters<typeof can>[1]]> = [
    ["learning.moderate", "moderate"],
    ["media.publish", "publish_media"],
    ["ideas.manage", "manage_ideas"],
    ["platform.administer", "administer"],
  ];

  it.each(privileged)("an ordinary employee is denied %s-gated action", (_perm, action) => {
    expect(can(employee(), action, res({ audience: "employee" })).allow).toBe(false);
  });

  it.each(privileged)("holding only %s does not unlock the other privileged actions", (perm, action) => {
    const p = employee([perm]);
    for (const [, other] of privileged) {
      expect(can(p, other, res({ audience: "employee" })).allow).toBe(other === action);
    }
  });

  it("ordinary employees cannot invite or grant roles", () => {
    expect(can(employee(), "invite_member", res({ audience: "tenant", orgId: AZ })).allow).toBe(false);
    expect(can(employee(), "grant_role", res({ audience: "tenant", orgId: AZ, targetRole: "client_member" })).allow).toBe(false);
  });

  it("a client administrator cannot escalate to employee, moderator, publisher or portal-admin", () => {
    const admin = client(MERIDIAN, "client_admin");
    for (const targetRole of ["employee", "moderator", "publisher", "portal_admin"] as const) {
      expect(can(admin, "grant_role", res({ audience: "tenant", orgId: MERIDIAN, targetRole })).allow).toBe(false);
    }
  });

  it("a client administrator can grant client roles only within their own organisation", () => {
    const admin = client(MERIDIAN, "client_admin");
    expect(can(admin, "grant_role", res({ audience: "tenant", orgId: MERIDIAN, targetRole: "client_member" })).allow).toBe(true);
    expect(can(admin, "grant_role", res({ audience: "tenant", orgId: NUSANTARA, targetRole: "client_member" })).allow).toBe(false);
    expect(can(admin, "invite_member", res({ audience: "tenant", orgId: NUSANTARA })).allow).toBe(false);
  });

  it("a plain client member cannot invite or grant", () => {
    const member = client(MERIDIAN, "client_member");
    expect(can(member, "invite_member", res({ audience: "tenant", orgId: MERIDIAN })).allow).toBe(false);
    expect(can(member, "grant_role", res({ audience: "tenant", orgId: MERIDIAN, targetRole: "client_member" })).allow).toBe(false);
  });

  it("grants held by a non-employee are inert", () => {
    const p = buildPrincipal({
      userId: "u", email: "u@bank.example", emailVerified: true,
      memberships: [{ orgId: MERIDIAN, orgKind: "client", role: "client_admin", status: "active", approvedBy: null }],
      grants: [{ permission: "learning.moderate", expiresAt: null }],
      sessionActiveOrgId: MERIDIAN, entitlements: [],
    });
    expect(can(p, "moderate", res({ audience: "shared_community" })).allow).toBe(false);
  });

  it("an expired grant confers nothing", () => {
    const p = buildPrincipal({
      userId: "e", email: "e@azentio.com", emailVerified: true,
      memberships: [{ orgId: AZ, orgKind: "azentio", role: "employee", status: "active", approvedBy: "org" }],
      grants: [{ permission: "support.access_private", expiresAt: new Date(Date.now() - 1000) }],
      sessionActiveOrgId: AZ, entitlements: [],
    });
    expect(can(p, "access_private", res({ audience: "tenant", orgId: MERIDIAN })).allow).toBe(false);
  });
});

describe("§03 required access rule: audience matrix", () => {
  const anon = null;
  const emp = employee();
  const memberA = client(MERIDIAN, "client_member", "a", ["credit-strategy-simulator"]);
  const adminB = client(NUSANTARA, "client_admin", "b");

  it("public is allowed to everyone, including anonymous visitors", () => {
    for (const p of [anon, emp, memberA]) expect(can(p, "read", res({ audience: "public" })).allow).toBe(true);
  });

  it.each([null, undefined])("missing audience metadata (%s) is DENIED, never public", (audience) => {
    for (const p of [anon, emp, memberA]) expect(can(p, "read", res({ audience })).allow).toBe(false);
  });

  it("an unrecognised audience value is denied", () => {
    expect(can(emp, "read", res({ audience: "everyone" as never })).allow).toBe(false);
  });

  it("employee audience: employees only", () => {
    const r = res({ audience: "employee" });
    expect(can(emp, "read", r).allow).toBe(true);
    expect(can(memberA, "read", r).allow).toBe(false);
    expect(can(anon, "read", r).allow).toBe(false);
  });

  it("§06: a client cannot reach an employee-only resource, e.g. an internal roadmap, by URL", () => {
    expect(can(memberA, "read", res({ audience: "employee" })).allow).toBe(false);
    expect(can(adminB, "read", res({ audience: "employee" })).allow).toBe(false);
  });

  it("tenant audience: only the matching active tenant, and employees get no automatic access", () => {
    const r = res({ audience: "tenant", orgId: MERIDIAN });
    expect(can(memberA, "read", r).allow).toBe(true);
    expect(can(adminB, "read", r).allow).toBe(false);
    expect(can(emp, "read", r).allow).toBe(false);
    expect(can(anon, "read", r).allow).toBe(false);
  });

  it("tenant with no owning org on the record is denied", () => {
    expect(can(memberA, "read", res({ audience: "tenant", orgId: null })).allow).toBe(false);
  });

  it("tenant_private: only the author within the tenant", () => {
    const r = res({ audience: "tenant_private", orgId: MERIDIAN, ownerId: "a" });
    expect(can(memberA, "read", r).allow).toBe(true);
    expect(can(client(MERIDIAN, "client_admin", "other"), "read", r).allow).toBe(false);
    expect(can(adminB, "read", r).allow).toBe(false);
  });

  it("entitled: tenant match AND product entitlement", () => {
    expect(can(memberA, "read", res({ audience: "entitled", orgId: MERIDIAN, entitlement: "credit-strategy-simulator" })).allow).toBe(true);
    expect(can(memberA, "read", res({ audience: "entitled", orgId: MERIDIAN, entitlement: "riva" })).allow).toBe(false);
    expect(can(memberA, "read", res({ audience: "entitled", orgId: MERIDIAN, entitlement: null })).allow).toBe(false);
    expect(can(adminB, "read", res({ audience: "entitled", orgId: MERIDIAN, entitlement: "credit-strategy-simulator" })).allow).toBe(false);
  });

  it("entitled content with no owning tenant: any client workspace holding the entitlement, nobody else", () => {
    const r = res({ audience: "entitled", entitlement: "credit-strategy-simulator" });
    expect(can(memberA, "read", r).allow).toBe(true); // entitled
    expect(can(adminB, "read", r).allow).toBe(false); // client, but not entitled
    expect(can(emp, "read", r).allow).toBe(false); // employees get no automatic access
    expect(can(anon, "read", r).allow).toBe(false);
    expect(can(memberA, "read", res({ audience: "entitled" })).allow).toBe(false); // names no product
  });

  it("shared_community: authorised participants only, not anonymous visitors", () => {
    const r = res({ audience: "shared_community" });
    expect(can(memberA, "read", r).allow).toBe(true);
    expect(can(emp, "read", r).allow).toBe(true);
    expect(can(anon, "read", r).allow).toBe(false);
  });

  it("a user with no active workspace cannot read tenant-scoped resources", () => {
    const p = buildPrincipal({
      userId: "u", email: "u@bank.example", emailVerified: true,
      memberships: [{ orgId: MERIDIAN, orgKind: "client", role: "client_member", status: "active", approvedBy: null }],
      grants: [], sessionActiveOrgId: null, entitlements: [],
    });
    expect(can(p, "read", res({ audience: "tenant", orgId: MERIDIAN })).allow).toBe(false);
  });
});

describe("§03 writes and private-content access", () => {
  it("ordinary employees cannot change public content or broadcasts; publishers can", () => {
    expect(can(employee(), "write", res({ audience: "public" })).allow).toBe(false);
    expect(can(employee(["media.publish"]), "write", res({ audience: "public" })).allow).toBe(true);
  });

  it("shared_community records are never written directly", () => {
    expect(can(employee(["learning.moderate", "platform.administer"]), "write", res({ audience: "shared_community" })).allow).toBe(false);
  });

  it("access to private client content needs explicit support authorisation, not a broad role", () => {
    const target = res({ audience: "tenant_private", orgId: MERIDIAN, ownerId: "a" });
    expect(can(employee(["platform.administer", "learning.moderate"]), "access_private", target).allow).toBe(false);
    expect(can(employee(["support.access_private"]), "access_private", target).allow).toBe(true);
  });

  it("support authorisation does not extend to non-tenant resources", () => {
    expect(can(employee(["support.access_private"]), "access_private", res({ audience: "public" })).allow).toBe(false);
  });

  it("the moderator role has no implicit access to unsubmitted client drafts", () => {
    const draft = res({ audience: "tenant_private", orgId: MERIDIAN, ownerId: "a" });
    expect(can(employee(["learning.moderate"]), "read", draft).allow).toBe(false);
  });
});

describe("§03: privileged actions are audited and refusals are 403", () => {
  it("writes an audit record for allowed and refused privileged actions", async () => {
    const log: AuditRecord[] = [];
    const audit = (r: AuditRecord) => void log.push(r);

    await requirePermission({ principal: employee(["learning.moderate"]), audit }, "moderate", res({ audience: "shared_community" }));
    await expect(
      requirePermission({ principal: employee(), audit }, "moderate", res({ audience: "shared_community" })),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(log.map((r) => r.allowed)).toEqual([true, false]);
    expect(log.every((r) => r.action === "moderate" && r.actorId === "emp-1")).toBe(true);
  });

  it("audits refused non-privileged reads too, but not routine allowed ones", async () => {
    const log: AuditRecord[] = [];
    const audit = (r: AuditRecord) => void log.push(r);
    await requirePermission({ principal: null, audit }, "read", res({ audience: "public" }));
    expect(log).toHaveLength(0);
    await expect(
      requirePermission({ principal: null, audit }, "read", res({ audience: "tenant", orgId: MERIDIAN })),
    ).rejects.toMatchObject({ status: 403 });
    expect(log).toHaveLength(1);
    expect(log[0].allowed).toBe(false);
  });
});
