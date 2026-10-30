import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../../src/lib/db/schema";
import type { Db } from "../../src/lib/db/client";
import type { AuditRecord } from "../../src/lib/authz/guard";
import { testDatabaseUrl } from "../global-setup";

process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
process.env.MAIL_TRANSPORT = "dev";

export function connect(): { db: Db; close: () => Promise<void> } {
  const client = postgres(testDatabaseUrl(), { max: 5 });
  return { db: drizzle(client, { schema: s }) as unknown as Db, close: () => client.end() };
}

export const uniq = () => randomBytes(4).toString("hex");

export function auditCollector() {
  const log: AuditRecord[] = [];
  return { log, sink: (r: AuditRecord) => void log.push(r) };
}

export async function azentioOrg(db: Db) {
  const [az] = await db.select().from(s.organizations).where(eq(s.organizations.kind, "azentio"));
  return az;
}

export async function organiser(db: Db) {
  const [u] = await db.select().from(s.users).where(eq(s.users.email, "organiser@azentio.com"));
  return u;
}

export async function makeClientOrg(db: Db, name = `Client ${uniq()}`) {
  const [o] = await db.insert(s.organizations).values({ kind: "client", name, industry: "Banking", region: "GCC" }).returning();
  return o;
}

export async function makeUser(db: Db, email: string, verified = true) {
  const [u] = await db
    .insert(s.users)
    .values({ email, displayName: email.split("@")[0], emailVerifiedAt: verified ? new Date() : null })
    .returning();
  return u;
}

export async function makeMembership(
  db: Db,
  userId: string,
  orgId: string,
  role: "employee" | "client_member" | "client_admin",
  opts: { terms?: boolean; approvedBy?: string | null } = {},
) {
  await db.insert(s.memberships).values({
    userId, orgId, role, status: "active",
    approvedBy: opts.approvedBy ?? null,
    termsAcceptedAt: opts.terms === false ? null : new Date(),
  });
}

/** Reads the most recent sign-in code "sent" to an address, as the dev mailbox would show it. */
export async function readCode(db: Db, email: string): Promise<string> {
  const [row] = await db
    .select()
    .from(s.outboxMessages)
    .where(and(eq(s.outboxMessages.toEmail, email), eq(s.outboxMessages.subject, "Your azentio.ai sign-in code")))
    .orderBy(desc(s.outboxMessages.at))
    .limit(1);
  const m = row?.body?.match(/\b(\d{6})\b/);
  if (!m) throw new Error(`no sign-in code queued for ${email}`);
  return m[1];
}

export async function outboxFor(db: Db, email: string) {
  return db.select().from(s.outboxMessages).where(eq(s.outboxMessages.toEmail, email));
}

import { createSession, loadSession } from "../../src/lib/auth/session";
import type { Permission } from "../../src/lib/authz/types";

/** A real employee: approved membership, optional separate grants, principal built from the session. */
export async function employeePrincipal(db: Db, grants: Permission[] = []) {
  const o = await organiser(db);
  const u = await makeUser(db, `emp-${uniq()}@azentio.com`);
  await makeMembership(db, u.id, (await azentioOrg(db)).id, "employee", { approvedBy: o.id });
  if (grants.length) await db.insert(s.platformGrants).values(grants.map((permission) => ({ userId: u.id, permission, grantedBy: o.id })));
  const ctx = (await loadSession(db, (await createSession(db, u.id)).token))!;
  return { user: u, principal: ctx.principal };
}

export async function clientPrincipal(db: Db, orgId: string, role: "client_member" | "client_admin" = "client_member") {
  const u = await makeUser(db, `cli-${uniq()}@client.example`);
  await makeMembership(db, u.id, orgId, role);
  const ctx = (await loadSession(db, (await createSession(db, u.id)).token))!;
  return { user: u, principal: ctx.principal };
}

import { switchWorkspace } from "../../src/lib/auth/session";

export async function grantEntitlement(db: Db, orgId: string, productSlug: string) {
  await db.insert(s.entitlements).values({ orgId, productSlug }).onConflictDoNothing();
}

export async function ensureProduct(db: Db, slug: string, audience: "public" | "employee" = "public") {
  await db.insert(s.products).values({ slug, name: slug, category: "Test", summary: `${slug} summary.`, audience }).onConflictDoNothing();
}

/** A fresh principal for an existing user, with the given workspace explicitly active. */
export async function principalIn(db: Db, userId: string, orgId: string) {
  const { token } = await createSession(db, userId);
  await switchWorkspace(db, token, orgId);
  return (await loadSession(db, token))!.principal;
}
