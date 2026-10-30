import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import {
  auditCollector, azentioOrg, clientPrincipal, connect, employeePrincipal, ensureProduct, grantEntitlement,
  makeClientOrg, makeMembership, makeUser, principalIn, readCode, uniq,
} from "../helpers/db";
import type { Db } from "../../src/lib/db/client";
import * as s from "../../src/lib/db/schema";
import { ForbiddenError } from "../../src/lib/authz/guard";
import { NotFoundError } from "../../src/lib/employee/service";
import {
  cancelInvitation, changeMemberRole, deleteSavedScenario, getClientDashboard, listClientResources,
  listMembers, listMySandboxRuns, listSandboxes, listSavedScenarios, revokeMember, runSandbox,
  saveSandboxFeedback, saveScenario,
} from "../../src/lib/client/service";
import {
  addComment, createSupportRequest, hideComment, listBookmarks, listComments, listReportedComments,
  listSupportRequests, reportComment, toggleBookmark,
} from "../../src/lib/client/collab";
import {
  createLiveSession, createReleaseNote, setMediaAudience, uploadMedia,
} from "../../src/lib/employee/service";
import { createInvitation, acceptInvitation, describeInvitation } from "../../src/lib/auth/invitations";
import { requestCode } from "../../src/lib/auth/otp";
import { listNotifications, markRead, notify, unreadCount } from "../../src/lib/notifications/inapp";
import { readMedia } from "../../src/lib/media/access";

process.env.PRIVATE_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "azentio-client-"));

let db: Db;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const SIM = "credit-strategy-simulator";
const FAI = "financial-analysis-intelligence";
const run = { scoreCutoff: 620, segment: 0 };

/** Two unrelated tenants, each with an admin and a member, and one shared product they are both entitled to. */
async function twoTenants() {
  await ensureProduct(db, SIM);
  await ensureProduct(db, FAI);
  const a = await makeClientOrg(db, `Tenant A ${uniq()}`);
  const b = await makeClientOrg(db, `Tenant B ${uniq()}`);
  await grantEntitlement(db, a.id, SIM);
  await grantEntitlement(db, b.id, SIM);
  const aAdmin = await clientPrincipal(db, a.id, "client_admin");
  const aMember = await clientPrincipal(db, a.id, "client_member");
  const bAdmin = await clientPrincipal(db, b.id, "client_admin");
  const bMember = await clientPrincipal(db, b.id, "client_member");
  return { a, b, aAdmin, aMember, bAdmin, bMember };
}

async function publisher() {
  return employeePrincipal(db, ["media.publish"]);
}

describe("§06 dashboard: empty states and no cross-tenant content", () => {
  it("an organisation with nothing assigned gets empty collections, not sample content", async () => {
    const org = await makeClientOrg(db);
    const { principal } = await clientPrincipal(db, org.id);
    const d = await getClientDashboard(db, principal, auditCollector().sink);
    expect(d.org.id).toBe(org.id);
    expect(d.offerings).toEqual([]);
    expect(d.demos).toEqual([]);
    expect(d.sessions).toEqual([]);
    expect(d.ideas).toEqual([]);
    expect(d.contributions).toEqual({});
  });

  it("never shows another tenant's content, whatever the type", async () => {
    const { a, b, aAdmin, bAdmin } = await twoTenants();
    const pub = await publisher();
    const tag = uniq();
    const sink = auditCollector().sink;

    await createLiveSession(db, pub.principal, sink, { title: `A webinar ${tag}`, audience: "tenant", orgId: a.id });
    await createLiveSession(db, pub.principal, sink, { title: `B webinar ${tag}`, audience: "tenant", orgId: b.id });
    await uploadMedia(db, pub.principal, sink, { title: `A briefing ${tag}`, kind: "document", audience: "tenant", orgId: a.id }, "image/png", PNG);
    await uploadMedia(db, pub.principal, sink, { title: `B briefing ${tag}`, kind: "document", audience: "tenant", orgId: b.id }, "image/png", PNG);
    await createReleaseNote(db, pub.principal, sink, { title: `A notes ${tag}`, body: "Notes for tenant A only.", audience: "tenant", orgId: a.id });
    await createReleaseNote(db, pub.principal, sink, { title: `B notes ${tag}`, body: "Notes for tenant B only.", audience: "tenant", orgId: b.id });

    const da = JSON.stringify(await getClientDashboard(db, aAdmin.principal, auditCollector().sink));
    const dra = JSON.stringify(await listClientResources(db, aAdmin.principal, auditCollector().sink));
    for (const out of [da, dra]) {
      expect(out).not.toContain(`B webinar ${tag}`);
      expect(out).not.toContain(`B briefing ${tag}`);
      expect(out).not.toContain(`B notes ${tag}`);
    }
    expect(da).toContain(`A webinar ${tag}`);
    expect(da).toContain(`A briefing ${tag}`);
    expect(dra).toContain(`A notes ${tag}`);

    const db_ = JSON.stringify(await listClientResources(db, bAdmin.principal, auditCollector().sink));
    expect(db_).toContain(`B notes ${tag}`);
    expect(db_).not.toContain(`A notes ${tag}`);
  });

  it("entitled demos reach only organisations entitled to that product", async () => {
    const org1 = await makeClientOrg(db);
    const org2 = await makeClientOrg(db);
    await ensureProduct(db, SIM);
    await grantEntitlement(db, org1.id, SIM);
    const p1 = await clientPrincipal(db, org1.id);
    const p2 = await clientPrincipal(db, org2.id);
    const pub = await publisher();
    const tag = uniq();
    await uploadMedia(db, pub.principal, auditCollector().sink, { title: `Demo ${tag}`, kind: "video", audience: "entitled", productSlug: SIM }, "image/png", PNG);

    expect(JSON.stringify(await getClientDashboard(db, p1.principal, auditCollector().sink))).toContain(`Demo ${tag}`);
    expect(JSON.stringify(await getClientDashboard(db, p2.principal, auditCollector().sink))).not.toContain(`Demo ${tag}`);
  });

  it("never shows employee-only or public-site content as client content", async () => {
    const org = await makeClientOrg(db);
    const { principal } = await clientPrincipal(db, org.id);
    const pub = await publisher();
    const tag = uniq();
    const sink = auditCollector().sink;
    await createLiveSession(db, pub.principal, sink, { title: `Internal ${tag}`, audience: "employee" });
    await createLiveSession(db, pub.principal, sink, { title: `Public ${tag}`, audience: "public" });
    await createReleaseNote(db, pub.principal, sink, { title: `Internal note ${tag}`, body: "Employees only please.", audience: "employee" });
    const out = JSON.stringify(await getClientDashboard(db, principal, auditCollector().sink)) + JSON.stringify(await listClientResources(db, principal, auditCollector().sink));
    expect(out).not.toContain(tag);
  });

  it("employee status gives no automatic access to a client workspace", async () => {
    const { principal } = await employeePrincipal(db, ["learning.moderate", "platform.administer", "support.access_private"]);
    const audit = auditCollector();
    await expect(getClientDashboard(db, principal, audit.sink)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listClientResources(db, principal, audit.sink)).rejects.toBeInstanceOf(ForbiddenError);
    expect(audit.log.some((r) => !r.allowed)).toBe(true);
  });

  it("contribution status counts include the caller's own and shared items, never colleagues' private drafts", async () => {
    const org = await makeClientOrg(db);
    const me = await clientPrincipal(db, org.id);
    const colleague = await clientPrincipal(db, org.id);
    const other = await makeClientOrg(db);
    const stranger = await clientPrincipal(db, other.id);
    const base = { kind: "market_observation", offering: "riva", body: "synthetic body text" } as const;
    await db.insert(s.contributions).values([
      { ...base, orgId: org.id, authorId: me.user.id, title: "mine", sharingChoice: "private", status: "draft" },
      { ...base, orgId: org.id, authorId: colleague.user.id, title: "their private draft", sharingChoice: "private", status: "draft" },
      { ...base, orgId: org.id, authorId: colleague.user.id, title: "their org-shared", sharingChoice: "organisation", status: "submitted" },
      { ...base, orgId: other.id, authorId: stranger.user.id, title: "other tenant", sharingChoice: "organisation", status: "submitted" },
    ]);
    const d = await getClientDashboard(db, me.principal, auditCollector().sink);
    expect(d.contributions).toEqual({ draft: 1, submitted: 1 });
  });
});

describe("§06 improvement ideas: relevant, approved and whitelisted", () => {
  async function makeIdea(over: Partial<typeof s.improvementIdeas.$inferInsert>) {
    const [i] = await db.insert(s.improvementIdeas).values({
      title: `Idea ${uniq()}`, problem: "INTERNAL problem statement", offering: FAI, ownerTeam: "Team X",
      proposedOutcome: "INTERNAL outcome", priority: "high", status: "under_review", ...over,
    }).returning();
    return i;
  }

  it("shows only published, relevant ideas, with a plain-language status and no internal fields", async () => {
    await ensureProduct(db, FAI);
    const org = await makeClientOrg(db);
    await grantEntitlement(db, org.id, FAI);
    const { principal } = await clientPrincipal(db, org.id);
    const elsewhere = await makeClientOrg(db);
    const outsider = await clientPrincipal(db, elsewhere.id);

    const published = await makeIdea({ clientVisible: true, clientSummary: "We are looking at this. Under review." });
    const unpublished = await makeIdea({ clientVisible: false });
    const irrelevant = await makeIdea({ clientVisible: true, offering: "persona-newsroom", clientSummary: "Not for you." });

    const d = await getClientDashboard(db, principal, auditCollector().sink);
    const ids = d.ideas.map((i) => i.id);
    expect(ids).toContain(published.id);
    expect(ids).not.toContain(unpublished.id);
    expect(ids).not.toContain(irrelevant.id);

    const idea = d.ideas.find((i) => i.id === published.id)!;
    expect(idea).toMatchObject({ statusLabel: "Under review", commitmentNote: "Not a commitment to deliver.", ownerTeam: "Team X" });
    const serialised = JSON.stringify(idea);
    for (const hidden of ["INTERNAL", "priority", "proposedOutcome", "clientVisible", "problem"]) expect(serialised).not.toContain(hidden);

    // An organisation that is neither entitled nor a contributor does not see it.
    expect((await getClientDashboard(db, outsider.principal, auditCollector().sink)).ideas.map((i) => i.id)).not.toContain(published.id);
  });

  it("a contributing organisation sees the idea its approved observation supports, even without the entitlement", async () => {
    const org = await makeClientOrg(db);
    const author = await clientPrincipal(db, org.id);
    const [c] = await db.insert(s.contributions).values({ orgId: org.id, authorId: author.user.id, kind: "market_observation", title: "t", body: "b", offering: "persona-newsroom", status: "published" }).returning();
    const [pub] = await db.insert(s.sharedPublications).values({ contributionId: c.id, title: "t", body: "b", offering: "persona-newsroom" }).returning();
    const [theme] = await db.insert(s.themes).values({ title: "Theme", summary: "x", offering: "persona-newsroom" }).returning();
    await db.insert(s.themeEvidence).values({ themeId: theme.id, publicationId: pub.id });
    const idea = await makeIdea({ clientVisible: true, offering: "persona-newsroom", themeId: theme.id, clientSummary: "Under review." });

    expect((await getClientDashboard(db, author.principal, auditCollector().sink)).ideas.map((i) => i.id)).toContain(idea.id);

    // Withdrawal removes the link, so relevance through that contribution ends with it.
    await db.update(s.sharedPublications).set({ withdrawnAt: new Date() }).where(eq(s.sharedPublications.id, pub.id));
    expect((await getClientDashboard(db, author.principal, auditCollector().sink)).ideas.map((i) => i.id)).not.toContain(idea.id);
  });
});

describe("§06 entitled sandboxes: tenant and user isolation", () => {
  it("offers only the scenarios the organisation is entitled to", async () => {
    await ensureProduct(db, SIM);
    const none = await clientPrincipal(db, (await makeClientOrg(db)).id);
    expect(listSandboxes(none.principal)).toEqual([]);
    const org = await makeClientOrg(db);
    await grantEntitlement(db, org.id, SIM);
    const some = await clientPrincipal(db, org.id);
    expect(listSandboxes(some.principal).map((x) => x.id)).toEqual([SIM]);
  });

  it("refuses an unentitled scenario, an employee, and an unknown scenario; refusals are audited", async () => {
    const org = await makeClientOrg(db);
    const { principal } = await clientPrincipal(db, org.id);
    const audit = auditCollector();
    await expect(runSandbox(db, principal, audit.sink, SIM, run)).rejects.toBeInstanceOf(ForbiddenError);
    expect(audit.log.some((r) => !r.allowed && r.subjectType === "sandbox")).toBe(true);
    await expect(runSandbox(db, principal, audit.sink, "nope", {})).rejects.toBeInstanceOf(NotFoundError);
    const emp = await employeePrincipal(db);
    await expect(runSandbox(db, emp.principal, audit.sink, SIM, run)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("stores each run against the tenant and user, and validates parameters first", async () => {
    const { a, aMember } = await twoTenants();
    const { id } = await runSandbox(db, aMember.principal, auditCollector().sink, SIM, run);
    const [row] = await db.select().from(s.playgroundRuns).where(eq(s.playgroundRuns.id, id));
    expect(row).toMatchObject({ orgId: a.id, userId: aMember.user.id });
    await expect(runSandbox(db, aMember.principal, auditCollector().sink, SIM, { scoreCutoff: 1 })).rejects.toBeInstanceOf(ZodError);
  });

  it("a colleague in the same organisation cannot see or annotate your runs", async () => {
    const { aAdmin, aMember } = await twoTenants();
    const { id } = await runSandbox(db, aMember.principal, auditCollector().sink, SIM, run);
    expect((await listMySandboxRuns(db, aMember.principal)).map((r) => r.id)).toContain(id);
    expect((await listMySandboxRuns(db, aAdmin.principal)).map((r) => r.id)).not.toContain(id);
    await expect(saveSandboxFeedback(db, aAdmin.principal, auditCollector().sink, id, { helpful: true, accuracy: 3 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the same person in two workspaces never sees one workspace's runs in the other", async () => {
    await ensureProduct(db, SIM);
    const x = await makeClientOrg(db);
    const y = await makeClientOrg(db);
    await grantEntitlement(db, x.id, SIM);
    await grantEntitlement(db, y.id, SIM);
    const u = await makeUser(db, `multi-${uniq()}@advisory.example`);
    await makeMembership(db, u.id, x.id, "client_member");
    await makeMembership(db, u.id, y.id, "client_member");

    const inX = await principalIn(db, u.id, x.id);
    const { id } = await runSandbox(db, inX, auditCollector().sink, SIM, run);
    const inY = await principalIn(db, u.id, y.id);

    expect((await listMySandboxRuns(db, inX)).map((r) => r.id)).toContain(id);
    expect((await listMySandboxRuns(db, inY)).map((r) => r.id)).not.toContain(id);
    await expect(saveSandboxFeedback(db, inY, auditCollector().sink, id, { helpful: true, accuracy: 4 })).rejects.toBeInstanceOf(NotFoundError);
    await saveSandboxFeedback(db, inX, auditCollector().sink, id, { helpful: true, accuracy: 4 });
  });

  it("employee Playground runs and client sandbox runs are kept apart", async () => {
    const { aMember } = await twoTenants();
    const { id } = await runSandbox(db, aMember.principal, auditCollector().sink, SIM, run);
    const emp = await employeePrincipal(db);
    const { saveRunFeedback } = await import("../../src/lib/employee/service");
    await expect(saveRunFeedback(db, emp.principal, auditCollector().sink, id, { helpful: true, accuracy: 3 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("saved scenarios: private by default, shareable only within the organisation, deletable only by the author", async () => {
    const { aAdmin, aMember, bAdmin } = await twoTenants();
    const sink = auditCollector().sink;
    const priv = await saveScenario(db, aMember.principal, sink, { name: "My private", scenarioId: SIM, params: run });
    const shared = await saveScenario(db, aMember.principal, sink, { name: "Team shared", scenarioId: SIM, params: run, visibility: "organisation" });

    const names = async (p: typeof aMember.principal) => (await listSavedScenarios(db, p)).map((x) => x.name);
    expect(await names(aMember.principal)).toEqual(expect.arrayContaining(["My private", "Team shared"]));
    expect(await names(aAdmin.principal)).toContain("Team shared");
    expect(await names(aAdmin.principal)).not.toContain("My private");
    expect(await names(bAdmin.principal)).not.toContain("Team shared");

    await expect(deleteSavedScenario(db, aAdmin.principal, sink, shared)).rejects.toBeInstanceOf(NotFoundError); // not the author
    await expect(deleteSavedScenario(db, bAdmin.principal, sink, shared)).rejects.toBeInstanceOf(NotFoundError); // other tenant
    await deleteSavedScenario(db, aMember.principal, sink, priv);
    expect(await names(aMember.principal)).not.toContain("My private");
  });

  it("only valid, entitled scenarios can be saved, and withdrawn entitlement hides them", async () => {
    await ensureProduct(db, SIM);
    const org = await makeClientOrg(db);
    await grantEntitlement(db, org.id, SIM);
    const m = await clientPrincipal(db, org.id);
    const sink = auditCollector().sink;
    await expect(saveScenario(db, m.principal, sink, { name: "Bad", scenarioId: SIM, params: { scoreCutoff: 1, segment: 0 } })).rejects.toBeInstanceOf(ZodError);
    await expect(saveScenario(db, m.principal, sink, { name: "Wrong", scenarioId: "sme-credit-decisioning", params: {} })).rejects.toBeInstanceOf(ForbiddenError);
    await saveScenario(db, m.principal, sink, { name: "Keep", scenarioId: SIM, params: run });

    await db.delete(s.entitlements).where(eq(s.entitlements.orgId, org.id));
    const after = await principalIn(db, m.user.id, org.id);
    expect(await listSavedScenarios(db, after)).toEqual([]);
  });
});

describe("§04/§06 member administration stays inside the organisation", () => {
  it("shows membership and invitation states to an administrator of that organisation only", async () => {
    const { a, aAdmin, aMember, bAdmin } = await twoTenants();
    const sink = auditCollector().sink;
    const t0 = new Date();
    const pending = await createInvitation(db, aAdmin.principal, sink, { orgId: a.id, email: `p-${uniq()}@a.example`, role: "client_member" }, t0);
    const old = await createInvitation(db, aAdmin.principal, sink, { orgId: a.id, email: `o-${uniq()}@a.example`, role: "client_member" }, new Date(t0.getTime() - 30 * 86_400_000));
    const cancelled = await createInvitation(db, aAdmin.principal, sink, { orgId: a.id, email: `c-${uniq()}@a.example`, role: "client_member" }, t0);
    await cancelInvitation(db, aAdmin.principal, sink, cancelled.invitationId);

    const list = await listMembers(db, aAdmin.principal, sink);
    const state = (id: string) => list.invitations.find((i) => i.id === id)?.state;
    expect(state(pending.invitationId)).toBe("pending");
    expect(state(old.invitationId)).toBe("expired");
    expect(state(cancelled.invitationId)).toBe("cancelled");
    expect(list.members.map((m) => m.userId)).toEqual(expect.arrayContaining([aAdmin.user.id, aMember.user.id]));
    expect(list.members.some((m) => m.you && m.userId === aAdmin.user.id)).toBe(true);

    const other = await listMembers(db, bAdmin.principal, sink);
    expect(JSON.stringify(other)).not.toContain(aAdmin.user.email);
    expect(other.invitations.map((i) => i.id)).not.toContain(pending.invitationId);

    await expect(listMembers(db, aMember.principal, sink)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an accepted invitation shows as accepted", async () => {
    const { a, aAdmin } = await twoTenants();
    const email = `acc-${uniq()}@a.example`;
    const { token, invitationId } = await createInvitation(db, aAdmin.principal, auditCollector().sink, { orgId: a.id, email, role: "client_member" });
    const u = await makeUser(db, email);
    await acceptInvitation(db, token, u.id, auditCollector().sink);
    const list = await listMembers(db, aAdmin.principal, auditCollector().sink);
    expect(list.invitations.find((i) => i.id === invitationId)?.state).toBe("accepted");
  });

  it("a cancelled invitation cannot be accepted, previewed, or used to request a sign-in code", async () => {
    const { a, aAdmin } = await twoTenants();
    const email = `cx-${uniq()}@a.example`;
    const { token, invitationId } = await createInvitation(db, aAdmin.principal, auditCollector().sink, { orgId: a.id, email, role: "client_member" });
    await cancelInvitation(db, aAdmin.principal, auditCollector().sink, invitationId);

    expect(await describeInvitation(db, token)).toBeNull();
    const u = await makeUser(db, email);
    await expect(acceptInvitation(db, token, u.id, auditCollector().sink)).rejects.toMatchObject({ code: "invalid_invitation" });
    await requestCode(db, `nobody-${email}`);
    await expect(readCode(db, `nobody-${email}`)).rejects.toThrow();
  });

  it("cannot cancel another organisation's invitation, and members cannot cancel at all", async () => {
    const { a, aAdmin, aMember, bAdmin } = await twoTenants();
    const { invitationId } = await createInvitation(db, aAdmin.principal, auditCollector().sink, { orgId: a.id, email: `x-${uniq()}@a.example`, role: "client_member" });
    await expect(cancelInvitation(db, bAdmin.principal, auditCollector().sink, invitationId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelInvitation(db, aMember.principal, auditCollector().sink, invitationId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("changes roles between client roles only, never to a platform role, and never your own", async () => {
    const { a, aAdmin, aMember, bAdmin } = await twoTenants();
    const sink = auditCollector().sink;
    await changeMemberRole(db, aAdmin.principal, sink, aMember.user.id, "client_admin");
    const [m] = await db.select().from(s.memberships).where(eq(s.memberships.userId, aMember.user.id));
    expect(m.role).toBe("client_admin");
    await changeMemberRole(db, aAdmin.principal, sink, aMember.user.id, "client_member");

    for (const bad of ["employee", "moderator", "publisher", "portal_admin"]) {
      await expect(changeMemberRole(db, aAdmin.principal, sink, aMember.user.id, bad)).rejects.toBeInstanceOf(ZodError);
    }
    await expect(changeMemberRole(db, aAdmin.principal, sink, aAdmin.user.id, "client_member")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeMemberRole(db, bAdmin.principal, sink, aMember.user.id, "client_admin")).rejects.toBeInstanceOf(NotFoundError);
    await expect(changeMemberRole(db, aMember.principal, sink, aAdmin.user.id, "client_member")).rejects.toBeInstanceOf(ForbiddenError);
    void a;
  });

  it("revoking removes access at once, leaves other organisations untouched, and refuses self-revocation", async () => {
    const { a, b, aAdmin, aMember, bAdmin } = await twoTenants();
    const sink = auditCollector().sink;
    // The same person is a member of both A and B.
    const shared = await makeUser(db, `shared-${uniq()}@advisory.example`);
    await makeMembership(db, shared.id, a.id, "client_member");
    await makeMembership(db, shared.id, b.id, "client_member");
    const inA = await principalIn(db, shared.id, a.id);
    expect(inA.activeOrgId).toBe(a.id);

    await revokeMember(db, aAdmin.principal, sink, shared.id);
    const rows = await db.select().from(s.memberships).where(eq(s.memberships.userId, shared.id));
    expect(rows.find((r) => r.orgId === a.id)?.status).toBe("revoked");
    expect(rows.find((r) => r.orgId === b.id)?.status).toBe("active");

    await expect(revokeMember(db, aAdmin.principal, sink, aAdmin.user.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revokeMember(db, bAdmin.principal, sink, aMember.user.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(revokeMember(db, aMember.principal, sink, aAdmin.user.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("§06 bookmarks", () => {
  it("only readable resources can be bookmarked; toggling twice removes it", async () => {
    const { a, b, aMember } = await twoTenants();
    const pub = await publisher();
    const sink = auditCollector().sink;
    const mine = await uploadMedia(db, pub.principal, sink, { title: "Mine", kind: "document", audience: "tenant", orgId: a.id }, "image/png", PNG);
    const theirs = await uploadMedia(db, pub.principal, sink, { title: "Theirs", kind: "document", audience: "tenant", orgId: b.id }, "image/png", PNG);
    const internal = await uploadMedia(db, pub.principal, sink, { title: "Internal", kind: "document", audience: "employee" }, "image/png", PNG);

    expect(await toggleBookmark(db, aMember.principal, sink, "media", mine)).toEqual({ bookmarked: true });
    await expect(toggleBookmark(db, aMember.principal, sink, "media", theirs)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(toggleBookmark(db, aMember.principal, sink, "media", internal)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(toggleBookmark(db, aMember.principal, sink, "media", "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(NotFoundError);
    await expect(toggleBookmark(db, aMember.principal, sink, "product", mine)).rejects.toBeInstanceOf(ZodError);
    expect((await listBookmarks(db, aMember.principal)).map((x) => x.title)).toEqual(["Mine"]);
    expect(await toggleBookmark(db, aMember.principal, sink, "media", mine)).toEqual({ bookmarked: false });
    expect(await listBookmarks(db, aMember.principal)).toEqual([]);
  });

  it("a bookmark stops surfacing once access to the resource is withdrawn, and stays inside its workspace", async () => {
    const x = await makeClientOrg(db);
    const y = await makeClientOrg(db);
    const u = await makeUser(db, `bm-${uniq()}@advisory.example`);
    await makeMembership(db, u.id, x.id, "client_member");
    await makeMembership(db, u.id, y.id, "client_member");
    const pub = await publisher();
    const sink = auditCollector().sink;
    const item = await uploadMedia(db, pub.principal, sink, { title: "Briefing", kind: "document", audience: "tenant", orgId: x.id }, "image/png", PNG);

    const inX = await principalIn(db, u.id, x.id);
    await toggleBookmark(db, inX, sink, "media", item);
    expect(await listBookmarks(db, inX)).toHaveLength(1);
    expect(await listBookmarks(db, await principalIn(db, u.id, y.id))).toEqual([]);

    await setMediaAudience(db, pub.principal, sink, item, "employee");
    expect(await listBookmarks(db, inX)).toEqual([]);
  });
});

describe("§06 comments inherit the parent's audience; moderation and reporting apply", () => {
  async function tenantItem(orgId: string, title = "Briefing") {
    const pub = await publisher();
    return uploadMedia(db, pub.principal, auditCollector().sink, { title, kind: "document", audience: "tenant", orgId }, "image/png", PNG);
  }

  it("members comment on their own organisation's content and see the thread", async () => {
    const { a, aAdmin, aMember } = await twoTenants();
    const item = await tenantItem(a.id);
    const sink = auditCollector().sink;
    await addComment(db, aMember.principal, sink, { parentType: "media", parentId: item, body: "Useful briefing." });
    await addComment(db, aAdmin.principal, sink, { parentType: "media", parentId: item, body: "Agreed." });
    expect((await listComments(db, aAdmin.principal, sink, "media", item)).map((c) => c.body)).toEqual(["Useful briefing.", "Agreed."]);
  });

  it("cannot comment on, or read comments of, content you cannot read", async () => {
    const { a, aMember, bMember } = await twoTenants();
    const item = await tenantItem(a.id);
    const sink = auditCollector().sink;
    await addComment(db, aMember.principal, sink, { parentType: "media", parentId: item, body: "Private to A." });
    await expect(addComment(db, bMember.principal, sink, { parentType: "media", parentId: item, body: "Sneaking in." })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listComments(db, bMember.principal, sink, "media", item)).rejects.toBeInstanceOf(ForbiddenError);
    const emp = await employeePrincipal(db);
    await expect(listComments(db, emp.principal, sink, "media", item)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("on content shared with several organisations, each organisation sees only its own comments", async () => {
    const { aMember, bMember } = await twoTenants();
    const pub = await publisher();
    const demo = await uploadMedia(db, pub.principal, auditCollector().sink, { title: "Shared demo", kind: "video", audience: "entitled", productSlug: SIM }, "image/png", PNG);
    const sink = auditCollector().sink;
    await addComment(db, aMember.principal, sink, { parentType: "media", parentId: demo, body: "From tenant A." });
    await addComment(db, bMember.principal, sink, { parentType: "media", parentId: demo, body: "From tenant B." });
    expect((await listComments(db, aMember.principal, sink, "media", demo)).map((c) => c.body)).toEqual(["From tenant A."]);
    expect((await listComments(db, bMember.principal, sink, "media", demo)).map((c) => c.body)).toEqual(["From tenant B."]);
  });

  it("comments are not available on public or employee content, and bodies are validated", async () => {
    const { aMember } = await twoTenants();
    const pub = await publisher();
    const sink = auditCollector().sink;
    const publicItem = await uploadMedia(db, pub.principal, sink, { title: "Public", kind: "image", audience: "public" }, "image/png", PNG);
    await expect(addComment(db, aMember.principal, sink, { parentType: "media", parentId: publicItem, body: "Hello" })).rejects.toBeInstanceOf(ForbiddenError);
    const item = await tenantItem((await db.select().from(s.memberships).where(eq(s.memberships.userId, aMember.user.id)))[0].orgId);
    await expect(addComment(db, aMember.principal, sink, { parentType: "media", parentId: item, body: "   " })).rejects.toBeInstanceOf(ZodError);
    await expect(addComment(db, aMember.principal, sink, { parentType: "media", parentId: item, body: "x".repeat(2001) })).rejects.toBeInstanceOf(ZodError);
    await expect(addComment(db, aMember.principal, sink, { parentType: "media", parentId: "00000000-0000-0000-0000-000000000000", body: "Hi" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a comment stops being readable when the parent's audience is withdrawn", async () => {
    const { a, aMember } = await twoTenants();
    const item = await tenantItem(a.id);
    const pub = await publisher();
    const sink = auditCollector().sink;
    await addComment(db, aMember.principal, sink, { parentType: "media", parentId: item, body: "Soon hidden." });
    await setMediaAudience(db, pub.principal, sink, item, "employee");
    await expect(listComments(db, aMember.principal, sink, "media", item)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reporting needs read access, never reveals the reporter to the author, and reaches moderators without the reporter's identity", async () => {
    const { a, aAdmin, aMember, bMember } = await twoTenants();
    const item = await tenantItem(a.id);
    const sink = auditCollector().sink;
    const commentId = await addComment(db, aMember.principal, sink, { parentType: "media", parentId: item, body: "Contains something dubious." });

    await expect(reportComment(db, bMember.principal, sink, commentId, { reason: "Misleading" })).rejects.toBeInstanceOf(NotFoundError);
    await reportComment(db, aAdmin.principal, sink, commentId, { reason: "Looks confidential" });
    await expect(reportComment(db, aAdmin.principal, sink, commentId, { reason: "no" })).rejects.toBeInstanceOf(ZodError);

    const mod = await employeePrincipal(db, ["learning.moderate"]);
    const reports = await listReportedComments(db, mod.principal, sink);
    const mine = reports.find((r) => r.commentId === commentId)!;
    expect(mine.reason).toBe("Looks confidential");
    expect(JSON.stringify(mine)).not.toContain(aAdmin.user.id);
    expect(Object.keys(mine)).not.toContain("reporterId");

    const ordinary = await employeePrincipal(db);
    await expect(listReportedComments(db, ordinary.principal, sink)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listReportedComments(db, aAdmin.principal, sink)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the author, an organisation administrator or a moderator may hide a comment; nobody else", async () => {
    const { a, aAdmin, aMember, bAdmin } = await twoTenants();
    const item = await tenantItem(a.id);
    const sink = auditCollector().sink;
    const colleague = await clientPrincipal(db, a.id, "client_member");
    const mk = () => addComment(db, aMember.principal, sink, { parentType: "media", parentId: item, body: `c-${uniq()}` });

    const c1 = await mk();
    await expect(hideComment(db, colleague.principal, sink, c1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(hideComment(db, bAdmin.principal, sink, c1)).rejects.toBeInstanceOf(NotFoundError);
    await hideComment(db, aMember.principal, sink, c1);
    const c2 = await mk();
    await hideComment(db, aAdmin.principal, sink, c2);
    const c3 = await mk();
    const mod = await employeePrincipal(db, ["learning.moderate"]);
    const audit = auditCollector();
    await hideComment(db, mod.principal, audit.sink, c3);
    expect(audit.log.at(-1)).toMatchObject({ action: "moderate", allowed: true, subjectType: "comment" });
    expect(await listComments(db, aAdmin.principal, sink, "media", item)).toEqual([]);
  });
});

describe("§06 notifications and support", () => {
  it("notifications are private to their recipient, and read-marking touches only the caller's own", async () => {
    const org = await makeClientOrg(db);
    const a = await clientPrincipal(db, org.id);
    const b = await clientPrincipal(db, org.id);
    await notify(db, a.user.id, "Your submission was returned", "/workspace/observations");
    await notify(db, a.user.id, "Another update");
    await notify(db, b.user.id, "For B only");

    expect(await unreadCount(db, a.user.id)).toBe(2);
    expect((await listNotifications(db, a.user.id)).map((n) => n.message)).not.toContain("For B only");

    const bOne = (await listNotifications(db, b.user.id))[0];
    expect(await markRead(db, a.user.id, bOne.id)).toBe(0); // cannot mark someone else's
    expect(await unreadCount(db, b.user.id)).toBe(1);
    expect(await markRead(db, a.user.id)).toBe(2);
    expect(await unreadCount(db, a.user.id)).toBe(0);
  });

  it("support requests are recorded per organisation and never shown to another", async () => {
    const { aMember, aAdmin, bAdmin } = await twoTenants();
    const sink = auditCollector().sink;
    await createSupportRequest(db, aMember.principal, sink, { subject: "Sandbox is slow", body: "Runs take a long time on our side." });
    expect((await listSupportRequests(db, aAdmin.principal)).map((r) => r.subject)).toContain("Sandbox is slow");
    expect((await listSupportRequests(db, bAdmin.principal)).map((r) => r.subject)).not.toContain("Sandbox is slow");
    await expect(createSupportRequest(db, aMember.principal, sink, { subject: "x", body: "y" })).rejects.toBeInstanceOf(ZodError);
    const emp = await employeePrincipal(db);
    await expect(createSupportRequest(db, emp.principal, sink, { subject: "Employee here", body: "I am not a client." })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("IAM-02 publishing to a specific tenant or product", () => {
  it("only a publisher can target a tenant, and the target must be a client organisation", async () => {
    const { a } = await twoTenants();
    const ordinary = await employeePrincipal(db);
    const pub = await publisher();
    const sink = auditCollector().sink;
    await expect(createLiveSession(db, ordinary.principal, sink, { title: "Sneaky webinar", audience: "tenant", orgId: a.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createLiveSession(db, pub.principal, sink, { title: "Needs an org", audience: "tenant" })).rejects.toBeInstanceOf(ZodError);
    await expect(createLiveSession(db, pub.principal, sink, { title: "Wrong kind of org", audience: "tenant", orgId: (await azentioOrg(db)).id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createLiveSession(db, pub.principal, sink, { title: "Ghost org", audience: "tenant", orgId: "00000000-0000-0000-0000-000000000000" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(uploadMedia(db, pub.principal, sink, { title: "Entitled needs product", kind: "video", audience: "entitled" }, "image/png", PNG)).rejects.toBeInstanceOf(ZodError);
    await expect(uploadMedia(db, pub.principal, sink, { title: "Ghost product", kind: "video", audience: "entitled", productSlug: `ghost-${uniq()}` }, "image/png", PNG)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("media aimed at one tenant is served to that tenant only, through the gated route", async () => {
    const { a, aMember, bMember } = await twoTenants();
    const pub = await publisher();
    const id = await uploadMedia(db, pub.principal, auditCollector().sink, { title: "A only", kind: "document", audience: "tenant", orgId: a.id }, "image/png", PNG);
    expect(await readMedia(db, aMember.principal, id)).toMatchObject({ status: 200 });
    expect(await readMedia(db, bMember.principal, id)).toMatchObject({ status: 403 });
    expect(await readMedia(db, null, id)).toMatchObject({ status: 401 });
    const emp = await employeePrincipal(db);
    expect(await readMedia(db, emp.principal, id)).toMatchObject({ status: 403 });
  });

  it("retargeting media moves access with it, in both directions", async () => {
    const { a, b, aMember, bMember } = await twoTenants();
    const pub = await publisher();
    const sink = auditCollector().sink;
    const id = await uploadMedia(db, pub.principal, sink, { title: "Movable", kind: "document", audience: "tenant", orgId: a.id }, "image/png", PNG);
    await setMediaAudience(db, pub.principal, sink, id, "tenant", { orgId: b.id });
    expect(await readMedia(db, aMember.principal, id)).toMatchObject({ status: 403 });
    expect(await readMedia(db, bMember.principal, id)).toMatchObject({ status: 200 });
    await setMediaAudience(db, pub.principal, sink, id, "entitled", { productSlug: SIM });
    const [row] = await db.select().from(s.mediaAssets).where(eq(s.mediaAssets.id, id));
    expect(row).toMatchObject({ audience: "entitled", ownerOrgId: null, productSlug: SIM });
  });
});
