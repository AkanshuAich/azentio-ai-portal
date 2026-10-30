import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { clientPrincipal, connect, ensureProduct, makeClientOrg, uniq } from "../helpers/db";
import type { Db } from "../../src/lib/db/client";
import * as s from "../../src/lib/db/schema";
import { withTenant } from "../../src/lib/db/tenant";
import { getContribution, listMine, createDraft } from "../../src/lib/learning/contributions";
import { auditCollector } from "../helpers/db";
import { NotFoundError } from "../../src/lib/employee/service";

let db: Db;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());

const TENANT_TABLES = ["contributions", "playground_runs", "saved_scenarios", "support_requests", "bookmarks", "comments", "saved_searches"];

/** Two tenants with one row in each tenant table, so every policy has something to hide. */
async function twoTenants() {
  await ensureProduct(db, "riva");
  const a = await makeClientOrg(db, `RLS A ${uniq()}`);
  const b = await makeClientOrg(db, `RLS B ${uniq()}`);
  const ua = await clientPrincipal(db, a.id);
  const ub = await clientPrincipal(db, b.id);
  const seed = async (orgId: string, userId: string) => {
    const [c] = await db.insert(s.contributions).values({ orgId, authorId: userId, kind: "market_observation", title: `row-${orgId}`, body: "synthetic body text", offering: "riva" }).returning();
    await db.insert(s.playgroundRuns).values({ userId, orgId, scenarioId: "x", params: {}, output: {} });
    await db.insert(s.savedScenarios).values({ orgId, userId, name: "n", scenarioId: "x", params: {} });
    await db.insert(s.supportRequests).values({ orgId, userId, subject: "sub", body: "support body text" });
    await db.insert(s.savedSearches).values({ orgId, userId, name: "n", query: {} });
    const [m] = await db.insert(s.mediaAssets).values({ title: "m", kind: "image", storageKey: "k", contentType: "image/png", byteSize: 1, audience: "tenant", ownerOrgId: orgId }).returning();
    await db.insert(s.bookmarks).values({ userId, orgId, resourceType: "media", resourceId: m.id });
    await db.insert(s.comments).values({ parentType: "media", parentId: m.id, orgId, authorId: userId, body: "comment" });
    return c;
  };
  const ca = await seed(a.id, ua.user.id);
  const cb = await seed(b.id, ub.user.id);
  return { a, b, ua, ub, ca, cb };
}

const count = async (q: { execute: Db["execute"] }, table: string, orgCol = "org_id") =>
  Number((await q.execute(sql.raw(`select count(*)::int as n from ${table} where ${orgCol} is not null`))).at(0)!.n);
const orgsSeen = async (q: { execute: Db["execute"] }, table: string) =>
  (await q.execute(sql.raw(`select distinct org_id from ${table}`))).map((r) => String(r.org_id));

describe("defence in depth: Postgres row-level security under the app layer", () => {
  it("is switched on, with a policy, for every tenant-owned table", async () => {
    const rows = await db.execute(sql`select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname)::int as policies from pg_class c where c.relname in (${sql.join(TENANT_TABLES.map((t) => sql`${t}`), sql`, `)}) order by 1`);
    expect(rows.map((r) => r.relname)).toEqual([...TENANT_TABLES].sort());
    for (const r of rows) { expect(r.relrowsecurity, String(r.relname)).toBe(true); expect(Number(r.policies), String(r.relname)).toBeGreaterThan(0); }
  });

  it("the app role is neither a superuser nor able to bypass row security", async () => {
    const [r] = await db.execute(sql`select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'azentio_app'`);
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcanlogin: false });
  });

  it("a query with NO tenant filter returns only the active tenant's rows, in every tenant table", async () => {
    const { a, b } = await twoTenants();
    for (const table of TENANT_TABLES) {
      const inA = await withTenant(db, a.id, (q) => orgsSeen(q, table));
      const inB = await withTenant(db, b.id, (q) => orgsSeen(q, table));
      expect(inA, `${table} as A`).toEqual([a.id]);
      expect(inB, `${table} as B`).toEqual([b.id]);
    }
    // The privileged connection (no role switch) still sees both: RLS is applied by the role, deliberately.
    const all = await orgsSeen(db, "contributions");
    expect(all).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it("a deliberately buggy query that forgets its WHERE clause still cannot read another tenant", async () => {
    const { a, cb } = await twoTenants();
    const leaked = await withTenant(db, a.id, (q) => q.select().from(s.contributions)); // no WHERE at all
    expect(leaked.length).toBeGreaterThan(0);
    expect(leaked.every((r) => r.orgId === a.id)).toBe(true);
    expect(leaked.some((r) => r.id === cb.id)).toBe(false);
  });

  it("with no organisation set, nothing is visible", async () => {
    await twoTenants();
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role azentio_app`);
      return tx.execute(sql`select count(*)::int as n from contributions`);
    });
    expect(Number(rows.at(0)!.n)).toBe(0);
  });

  it("cannot write into another tenant, or modify or delete its rows", async () => {
    const { a, b, ua, cb } = await twoTenants();
    // INSERT naming the other tenant is rejected by the policy's WITH CHECK.
    await expect(withTenant(db, a.id, (q) => q.insert(s.contributions).values({ orgId: b.id, authorId: ua.user.id, kind: "market_observation", title: "sneak", body: "synthetic body text", offering: "riva" }))).rejects.toThrow();
    // UPDATE and DELETE of the other tenant's row touch nothing.
    const upd = await withTenant(db, a.id, (q) => q.update(s.contributions).set({ title: "hacked" }).where(sql`${s.contributions.id} = ${cb.id}`).returning({ id: s.contributions.id }));
    const del = await withTenant(db, a.id, (q) => q.delete(s.contributions).where(sql`${s.contributions.id} = ${cb.id}`).returning({ id: s.contributions.id }));
    expect(upd).toEqual([]);
    expect(del).toEqual([]);
    const [still] = await db.select().from(s.contributions).where(sql`${s.contributions.id} = ${cb.id}`);
    expect(still.title).not.toBe("hacked");
  });

  it("the tenant and role are transaction-local: they do not leak onto the next use of a pooled connection", async () => {
    const { a } = await twoTenants();
    await withTenant(db, a.id, async (q) => count(q, "contributions"));
    const [who] = await db.execute(sql`select current_user as u, current_setting('app.current_org', true) as org`);
    expect(who.u).not.toBe("azentio_app");
    expect(who.org ?? "").toBe("");
  });

  it("rejects a malformed organisation id before touching the database", async () => {
    await expect(withTenant(db, "'; drop table contributions; --", async () => 1)).rejects.toThrow(/invalid organisation id/);
    await expect(withTenant(db, "", async () => 1)).rejects.toThrow();
  });

  it("the application's own reads work through it, and a foreign id is simply 'not found'", async () => {
    await ensureProduct(db, "riva");
    const a = await clientPrincipal(db, (await makeClientOrg(db)).id);
    const b = await clientPrincipal(db, (await makeClientOrg(db)).id);
    const { id } = await createDraft(db, a.principal, auditCollector().sink, { kind: "market_observation", title: "RLS draft", body: "A private draft about nothing in particular.", offering: "riva", sharingChoice: "private" }, { store_process: true });
    expect((await listMine(db, a.principal)).map((c) => c.id)).toContain(id);
    expect((await getContribution(db, a.principal, auditCollector().sink, id)).id).toBe(id);
    await expect(getContribution(db, b.principal, auditCollector().sink, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("every table with an organisation column is either under row-level security or consciously exempt", async () => {
    const cols = await db.execute(sql`
      select c.table_name, c.column_name from information_schema.columns c
      join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name in ('org_id', 'owner_org_id', 'active_org_id')`);
    const withOrg = [...new Set(cols.map((r) => String(r.table_name)))].sort();

    // Exempt on purpose. Each is governed by the audience policy or must be readable across tenants for the
    // feature to work (authentication, entitlement lookups, audit, the cross-client shared feed, moderation).
    const EXEMPT: Record<string, string> = {
      audit_events: "append-only trail written for any tenant",
      entitlements: "read during authentication, before a tenant is active",
      fl_enrolments: "the coordinator (employee audience) reads every enrolment to run the programme; client reads filter on the session organisation in the service and are covered by tests",
      invitations: "looked up by token before the user belongs to the organisation",
      live_sessions: "audience policy decides (public, employee, tenant)",
      media_assets: "audience policy decides (public, employee, tenant, entitled)",
      memberships: "needed across organisations to resolve a user's workspaces",
      organizations: "directory of organisations",
      release_notes: "audience policy decides",
      sessions: "resolved from the cookie before a tenant is active",
    };
    const protectedTables = TENANT_TABLES;
    const undecided = withOrg.filter((t) => !protectedTables.includes(t) && !(t in EXEMPT));
    // A new table that carries an organisation column must be added to a policy or to EXEMPT, with a reason.
    expect(undecided).toEqual([]);
  });
});
