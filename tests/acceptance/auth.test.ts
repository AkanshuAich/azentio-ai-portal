import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  auditCollector, azentioOrg, connect, makeClientOrg, makeMembership, makeUser, organiser,
  outboxFor, readCode, uniq,
} from "../helpers/db";
import type { Db } from "../../src/lib/db/client";
import * as s from "../../src/lib/db/schema";
import { CODE_TTL_MS, MAX_ATTEMPTS, MAX_REQUESTS_PER_WINDOW, requestCode, verifyCode } from "../../src/lib/auth/otp";
import {
  acceptTerms, createSession, destroySession, loadSession, switchWorkspace,
} from "../../src/lib/auth/session";
import {
  InvitationError, acceptInvitation, createInvitation, describeInvitation, revokeMembership,
} from "../../src/lib/auth/invitations";
import { queueEmail } from "../../src/lib/notifications/outbox";
import { ForbiddenError } from "../../src/lib/authz/guard";
import { can } from "../../src/lib/authz/policy";

let db: Db;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());

const approveEmployee = async (email: string) => {
  const o = await organiser(db);
  await db.insert(s.employeeAllowlist).values({ email, approvedBy: o.id });
};

describe("§04 employee sign-in: verified @azentio.com identity PLUS approved membership", () => {
  it("sends no code to an external address and creates nothing (response is identical)", async () => {
    const email = `stranger-${uniq()}@gmail.com`;
    await expect(requestCode(db, email)).resolves.toBeUndefined();
    expect(await outboxFor(db, email)).toHaveLength(0);
    expect(await db.select().from(s.loginChallenges).where(eq(s.loginChallenges.email, email))).toHaveLength(0);
  });

  it("sends no code to an @azentio.com address that the organiser has not approved", async () => {
    const email = `unapproved-${uniq()}@azentio.com`;
    await requestCode(db, email);
    expect(await outboxFor(db, email)).toHaveLength(0);
  });

  it("an approved employee signs in with an emailed code and receives an approved employee membership", async () => {
    const email = `hire-${uniq()}@azentio.com`;
    await approveEmployee(email);
    await requestCode(db, email);

    const code = await readCode(db, email);
    const userId = await verifyCode(db, email, code);
    expect(userId).toBeTruthy();

    const { token } = await createSession(db, userId!);
    const ctx = await loadSession(db, token);
    expect(ctx?.principal.isEmployee).toBe(true);
    expect(ctx?.principal.activeOrgId).toBe((await azentioOrg(db)).id);
    // Employee status implies NO platform grant (IAM-02).
    expect(ctx?.principal.permissions.size).toBe(0);
  });

  it("an existing @azentio.com user without an approved membership is not an employee", async () => {
    const email = `suffix-only-${uniq()}@azentio.com`;
    const u = await makeUser(db, email);
    const { token } = await createSession(db, u.id);
    const ctx = await loadSession(db, token);
    expect(ctx?.principal.isEmployee).toBe(false);
    expect(can(ctx!.principal, "read", { audience: "employee" }).allow).toBe(false);
  });

  it("an unverified identity is not an employee even with an approved membership", async () => {
    const o = await organiser(db);
    const u = await makeUser(db, `unverified-${uniq()}@azentio.com`, false);
    await makeMembership(db, u.id, (await azentioOrg(db)).id, "employee", { approvedBy: o.id });
    const { token } = await createSession(db, u.id);
    expect((await loadSession(db, token))?.principal.isEmployee).toBe(false);
  });
});

describe("one-time code lifecycle", () => {
  async function approved() {
    const email = `otp-${uniq()}@azentio.com`;
    await approveEmployee(email);
    return email;
  }

  it("stores only a hash of the code", async () => {
    const email = await approved();
    await requestCode(db, email);
    const code = await readCode(db, email);
    const [row] = await db.select().from(s.loginChallenges).where(eq(s.loginChallenges.email, email));
    expect(row.codeHash).not.toContain(code);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a code works once", async () => {
    const email = await approved();
    await requestCode(db, email);
    const code = await readCode(db, email);
    expect(await verifyCode(db, email, code)).toBeTruthy();
    expect(await verifyCode(db, email, code)).toBeNull();
  });

  it("an expired code is rejected", async () => {
    const email = await approved();
    const t0 = new Date();
    await requestCode(db, email, t0);
    const code = await readCode(db, email);
    expect(await verifyCode(db, email, code, new Date(t0.getTime() + CODE_TTL_MS + 1000))).toBeNull();
  });

  it("locks out after too many wrong guesses, even for the correct code", async () => {
    const email = await approved();
    await requestCode(db, email);
    const code = await readCode(db, email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_ATTEMPTS; i++) expect(await verifyCode(db, email, wrong)).toBeNull();
    expect(await verifyCode(db, email, code)).toBeNull();
  });

  it("malformed codes and addresses are rejected without touching the database state", async () => {
    const email = await approved();
    await requestCode(db, email);
    expect(await verifyCode(db, email, "12345")).toBeNull();
    expect(await verifyCode(db, email, "abcdef")).toBeNull();
    expect(await verifyCode(db, "not-an-email", "123456")).toBeNull();
  });

  it("rate-limits code requests per address", async () => {
    const email = await approved();
    for (let i = 0; i < MAX_REQUESTS_PER_WINDOW + 3; i++) await requestCode(db, email);
    const rows = await db.select().from(s.loginChallenges).where(eq(s.loginChallenges.email, email));
    expect(rows).toHaveLength(MAX_REQUESTS_PER_WINDOW);
  });
});

describe("notification discipline", () => {
  it("never labels a queued or locally logged email as delivered", async () => {
    const email = `state-${uniq()}@azentio.com`;
    await approveEmployee(email);
    await requestCode(db, email);
    const [msg] = await outboxFor(db, email);
    expect(["queued", "dev_logged", "sent"]).toContain(msg.state);
    expect(msg.state).not.toBe("delivered");
  });

  it("is idempotent: the same key never queues two messages", async () => {
    const email = `idem-${uniq()}@example.com`;
    const msg = { toEmail: email, subject: "x", body: "y", secret: false, idempotencyKey: `idem:${email}` };
    const a = await queueEmail(db, msg);
    const b = await queueEmail(db, msg);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
    expect(await outboxFor(db, email)).toHaveLength(1);
  });
});

describe("§04 client invitations", () => {
  async function setup() {
    const orgA = await makeClientOrg(db);
    const orgB = await makeClientOrg(db);
    const admin = await makeUser(db, `admin-${uniq()}@a.example`);
    await makeMembership(db, admin.id, orgA.id, "client_admin");
    const { token } = await createSession(db, admin.id);
    const ctx = (await loadSession(db, token))!;
    return { orgA, orgB, admin, principal: ctx.principal };
  }

  it("a client administrator can invite into their own organisation", async () => {
    const { orgA, principal } = await setup();
    const email = `invitee-${uniq()}@a.example`;
    const { invitationId } = await createInvitation(db, principal, auditCollector().sink, {
      orgId: orgA.id, email, role: "client_member",
    });
    expect(invitationId).toBeTruthy();
    const [mail] = await outboxFor(db, email);
    expect(mail.body).toContain("/invite/");
  });

  it("stores only a hash of the invitation token", async () => {
    const { orgA, principal } = await setup();
    const { token, invitationId } = await createInvitation(db, principal, auditCollector().sink, {
      orgId: orgA.id, email: `h-${uniq()}@a.example`, role: "client_member",
    });
    const [row] = await db.select().from(s.invitations).where(eq(s.invitations.id, invitationId));
    expect(row.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("cannot invite into another client organisation, and the refusal is audited", async () => {
    const { orgB, principal } = await setup();
    const a = auditCollector();
    await expect(
      createInvitation(db, principal, a.sink, { orgId: orgB.id, email: `x-${uniq()}@b.example`, role: "client_member" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(a.log.some((r) => r.action === "invite_member" && !r.allowed)).toBe(true);
  });

  it("cannot propose employee, moderator, publisher or portal-admin roles", async () => {
    const { orgA, principal } = await setup();
    for (const role of ["employee", "moderator", "publisher", "portal_admin"]) {
      await expect(
        createInvitation(db, principal, auditCollector().sink, {
          orgId: orgA.id, email: `esc-${uniq()}@a.example`, role: role as never,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("cannot invite into the Azentio organisation", async () => {
    const { principal } = await setup();
    await expect(
      createInvitation(db, principal, auditCollector().sink, {
        orgId: (await azentioOrg(db)).id, email: `az-${uniq()}@a.example`, role: "client_member",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a plain client member cannot invite", async () => {
    const orgA = await makeClientOrg(db);
    const m = await makeUser(db, `member-${uniq()}@a.example`);
    await makeMembership(db, m.id, orgA.id, "client_member");
    const ctx = (await loadSession(db, (await createSession(db, m.id)).token))!;
    await expect(
      createInvitation(db, ctx.principal, auditCollector().sink, { orgId: orgA.id, email: `y-${uniq()}@a.example`, role: "client_member" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("full first-time journey: invite, verify identity, accept, then terms before entering the workspace", async () => {
    const { orgA, principal } = await setup();
    const email = `new-${uniq()}@a.example`;
    const { token: inviteToken } = await createInvitation(db, principal, auditCollector().sink, {
      orgId: orgA.id, email, role: "client_member",
    });

    expect(await describeInvitation(db, inviteToken)).toMatchObject({ orgName: orgA.name, role: "client_member" });

    // The invitee has no account yet, but holding a live invitation lets them prove their identity.
    await requestCode(db, email);
    const userId = (await verifyCode(db, email, await readCode(db, email)))!;
    expect(userId).toBeTruthy();

    // Verified, but NOT a member: no trusted tenant membership from the address alone.
    expect(await db.select().from(s.memberships).where(eq(s.memberships.userId, userId))).toHaveLength(0);

    const audit = auditCollector();
    await acceptInvitation(db, inviteToken, userId, audit.sink);
    expect(audit.log.at(-1)).toMatchObject({ allowed: true });

    // Joined, but terms are unaccepted, so the workspace confers nothing yet.
    let ctx = (await loadSession(db, (await createSession(db, userId)).token))!;
    expect(ctx.principal.activeOrgId).toBeNull();
    expect(can(ctx.principal, "read", { audience: "tenant", orgId: orgA.id }).allow).toBe(false);
    expect(ctx.workspaces[0]).toMatchObject({ orgName: orgA.name, termsAccepted: false });

    await acceptTerms(db, userId, orgA.id);
    ctx = (await loadSession(db, (await createSession(db, userId)).token))!;
    expect(ctx.principal.activeOrgId).toBe(orgA.id);
    expect(can(ctx.principal, "read", { audience: "tenant", orgId: orgA.id }).allow).toBe(true);
  });

  it("only the intended verified account can accept; another verified account is refused", async () => {
    const { orgA, principal } = await setup();
    const { token } = await createInvitation(db, principal, auditCollector().sink, {
      orgId: orgA.id, email: `intended-${uniq()}@a.example`, role: "client_member",
    });
    const other = await makeUser(db, `other-${uniq()}@a.example`);
    const audit = auditCollector();
    await expect(acceptInvitation(db, token, other.id, audit.sink)).rejects.toBeInstanceOf(InvitationError);
    expect(audit.log.at(-1)).toMatchObject({ allowed: false });
    expect(await db.select().from(s.memberships).where(eq(s.memberships.userId, other.id))).toHaveLength(0);
  });

  it("an unverified account holding the right address cannot accept", async () => {
    const { orgA, principal } = await setup();
    const email = `unv-${uniq()}@a.example`;
    const { token } = await createInvitation(db, principal, auditCollector().sink, { orgId: orgA.id, email, role: "client_member" });
    const u = await makeUser(db, email, false);
    await expect(acceptInvitation(db, token, u.id, auditCollector().sink)).rejects.toBeInstanceOf(InvitationError);
  });

  it("an invitation is single-use", async () => {
    const { orgA, principal } = await setup();
    const email = `once-${uniq()}@a.example`;
    const { token } = await createInvitation(db, principal, auditCollector().sink, { orgId: orgA.id, email, role: "client_member" });
    const u = await makeUser(db, email);
    await acceptInvitation(db, token, u.id, auditCollector().sink);
    await expect(acceptInvitation(db, token, u.id, auditCollector().sink)).rejects.toBeInstanceOf(InvitationError);
    expect(await describeInvitation(db, token)).toBeNull();
  });

  it("two simultaneous acceptances: exactly one succeeds", async () => {
    const { orgA, principal } = await setup();
    const email = `race-${uniq()}@a.example`;
    const { token } = await createInvitation(db, principal, auditCollector().sink, { orgId: orgA.id, email, role: "client_member" });
    const u = await makeUser(db, email);
    const results = await Promise.allSettled([
      acceptInvitation(db, token, u.id, auditCollector().sink),
      acceptInvitation(db, token, u.id, auditCollector().sink),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("an expired invitation is refused", async () => {
    const { orgA, principal } = await setup();
    const email = `exp-${uniq()}@a.example`;
    const t0 = new Date();
    const { token } = await createInvitation(db, principal, auditCollector().sink, { orgId: orgA.id, email, role: "client_member" }, t0);
    const u = await makeUser(db, email);
    const later = new Date(t0.getTime() + 8 * 24 * 60 * 60 * 1000);
    await expect(acceptInvitation(db, token, u.id, auditCollector().sink, later)).rejects.toBeInstanceOf(InvitationError);
    expect(await describeInvitation(db, token, later)).toBeNull();
  });

  it("an unknown token reveals nothing", async () => {
    expect(await describeInvitation(db, "not-a-real-token")).toBeNull();
    const u = await makeUser(db, `nobody-${uniq()}@a.example`);
    await expect(acceptInvitation(db, "not-a-real-token", u.id, auditCollector().sink)).rejects.toMatchObject({ code: "invalid_invitation" });
  });

  it("revoking a membership removes access immediately and only within the caller's own organisation", async () => {
    const { orgA, orgB, principal } = await setup();
    const victim = await makeUser(db, `victim-${uniq()}@a.example`);
    await makeMembership(db, victim.id, orgA.id, "client_member");
    const { token } = await createSession(db, victim.id);
    expect((await loadSession(db, token))?.principal.activeOrgId).toBe(orgA.id);

    await revokeMembership(db, principal, auditCollector().sink, orgA.id, victim.id);
    const after = await loadSession(db, token);
    expect(after?.principal.activeOrgId).toBeNull();
    expect(can(after!.principal, "read", { audience: "tenant", orgId: orgA.id }).allow).toBe(false);

    await expect(revokeMembership(db, principal, auditCollector().sink, orgB.id, victim.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("§04 active workspace and sessions", () => {
  it("a multi-membership user must choose a workspace; none is silently picked", async () => {
    const orgA = await makeClientOrg(db);
    const orgB = await makeClientOrg(db);
    const u = await makeUser(db, `multi-${uniq()}@a.example`);
    await makeMembership(db, u.id, orgA.id, "client_member");
    await makeMembership(db, u.id, orgB.id, "client_member");

    const { token } = await createSession(db, u.id);
    const ctx = (await loadSession(db, token))!;
    expect(ctx.principal.activeOrgId).toBeNull();
    expect(ctx.workspaces).toHaveLength(2);
    expect(can(ctx.principal, "read", { audience: "tenant", orgId: orgA.id }).allow).toBe(false);

    expect(await switchWorkspace(db, token, orgB.id)).toBe(true);
    const after = (await loadSession(db, token))!;
    expect(after.principal.activeOrgId).toBe(orgB.id);
    expect(can(after.principal, "read", { audience: "tenant", orgId: orgB.id }).allow).toBe(true);
    expect(can(after.principal, "read", { audience: "tenant", orgId: orgA.id }).allow).toBe(false);
  });

  it("cannot switch into an organisation the user does not belong to (forged tenant id)", async () => {
    const mine = await makeClientOrg(db);
    const theirs = await makeClientOrg(db);
    const u = await makeUser(db, `forge-${uniq()}@a.example`);
    await makeMembership(db, u.id, mine.id, "client_member");
    const { token } = await createSession(db, u.id);
    expect(await switchWorkspace(db, token, theirs.id)).toBe(false);
    expect((await loadSession(db, token))?.principal.activeOrgId).toBe(mine.id);
  });

  it("cannot switch into a workspace whose terms are unaccepted", async () => {
    const a = await makeClientOrg(db);
    const b = await makeClientOrg(db);
    const u = await makeUser(db, `terms-${uniq()}@a.example`);
    await makeMembership(db, u.id, a.id, "client_member");
    await makeMembership(db, u.id, b.id, "client_member", { terms: false });
    const { token } = await createSession(db, u.id);
    expect(await switchWorkspace(db, token, b.id)).toBe(false);
  });

  it("an unknown, destroyed or expired session token yields no principal", async () => {
    expect(await loadSession(db, "garbage")).toBeNull();
    expect(await loadSession(db, undefined)).toBeNull();

    const u = await makeUser(db, `sess-${uniq()}@a.example`);
    const t0 = new Date();
    const { token } = await createSession(db, u.id, t0);
    expect(await loadSession(db, token, t0)).not.toBeNull();
    expect(await loadSession(db, token, new Date(t0.getTime() + 9 * 60 * 60 * 1000))).toBeNull();

    await destroySession(db, token);
    expect(await loadSession(db, token, t0)).toBeNull();
  });

  it("the cookie token is never stored in the database", async () => {
    const u = await makeUser(db, `tok-${uniq()}@a.example`);
    const { token } = await createSession(db, u.id);
    const rows = await db.select().from(s.sessions).where(eq(s.sessions.userId, u.id));
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});
