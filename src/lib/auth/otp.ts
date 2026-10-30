import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  employeeAllowlist, invitations, loginChallenges, memberships, organizations, users,
} from "@/lib/db/schema";
import { queueEmail } from "@/lib/notifications/outbox";
import {
  hashCode, isEmailShaped, newCode, normaliseEmail, safeEqual,
} from "./crypto";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const MAX_REQUESTS_PER_WINDOW = 5;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const EMPLOYEE_DOMAIN = "@azentio.com";

/**
 * Who may be sent a code. Never decided by the address alone:
 *  - an existing user,
 *  - an organiser-approved employee (allowlist AND the @azentio.com domain), or
 *  - an address holding a live invitation, so an invitee can prove their identity before accepting.
 * An arbitrary external address is not eligible, and cannot create a trusted tenant membership.
 */
async function isEligible(db: Db, email: string, now: Date): Promise<boolean> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (u) return true;

  if (email.endsWith(EMPLOYEE_DOMAIN)) {
    const [a] = await db.select().from(employeeAllowlist).where(eq(employeeAllowlist.email, email));
    if (a) return true;
  }

  const [inv] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.email, email), isNull(invitations.consumedAt), gt(invitations.expiresAt, now)));
  return Boolean(inv);
}

/**
 * Always resolves the same way for every input so callers cannot learn which addresses are known.
 * A code is only generated and queued for eligible addresses.
 */
export async function requestCode(db: Db, rawEmail: string, now = new Date()): Promise<void> {
  const email = normaliseEmail(rawEmail);
  if (!isEmailShaped(email)) return;

  const since = new Date(now.getTime() - REQUEST_WINDOW_MS);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginChallenges)
    .where(and(eq(loginChallenges.email, email), gt(loginChallenges.createdAt, since)));
  if (n >= MAX_REQUESTS_PER_WINDOW) return;

  if (!(await isEligible(db, email, now))) return;

  const code = newCode();
  const [challenge] = await db
    .insert(loginChallenges)
    .values({ email, codeHash: hashCode(email, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS) })
    .returning({ id: loginChallenges.id });

  await queueEmail(db, {
    toEmail: email,
    subject: "Your azentio.ai sign-in code",
    body: `Your sign-in code is ${code}. It expires in 10 minutes. If you did not request it, ignore this message.`,
    secret: true,
    idempotencyKey: `signin:${challenge.id}`,
  });
}

/**
 * Verifies a code and returns the verified user id, or null. A failed attempt is counted before the
 * comparison, so concurrent guesses cannot exceed MAX_ATTEMPTS. A code works once.
 */
export async function verifyCode(
  db: Db,
  rawEmail: string,
  code: string,
  now = new Date(),
): Promise<string | null> {
  const email = normaliseEmail(rawEmail);
  if (!isEmailShaped(email) || !/^\d{6}$/.test(code)) return null;

  const [latest] = await db
    .select()
    .from(loginChallenges)
    .where(and(eq(loginChallenges.email, email), isNull(loginChallenges.consumedAt), gt(loginChallenges.expiresAt, now)))
    .orderBy(desc(loginChallenges.createdAt))
    .limit(1);
  if (!latest) return null;

  const [bumped] = await db
    .update(loginChallenges)
    .set({ attempts: sql`${loginChallenges.attempts} + 1` })
    .where(and(eq(loginChallenges.id, latest.id), sql`${loginChallenges.attempts} < ${MAX_ATTEMPTS}`))
    .returning({ id: loginChallenges.id });
  if (!bumped) return null;

  if (!safeEqual(latest.codeHash, hashCode(email, code))) return null;

  const [consumed] = await db
    .update(loginChallenges)
    .set({ consumedAt: now })
    .where(and(eq(loginChallenges.id, latest.id), isNull(loginChallenges.consumedAt)))
    .returning({ id: loginChallenges.id });
  if (!consumed) return null;

  return resolveVerifiedUser(db, email, now);
}

/** Marks the identity verified, creating the user and approved employee membership where applicable. */
async function resolveVerifiedUser(db: Db, email: string, now: Date): Promise<string | null> {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    if (!existing.emailVerifiedAt) {
      await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, existing.id));
    }
    return existing.id;
  }

  const [approved] = email.endsWith(EMPLOYEE_DOMAIN)
    ? await db.select().from(employeeAllowlist).where(eq(employeeAllowlist.email, email))
    : [];

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ email, displayName: email.split("@")[0], emailVerifiedAt: now })
      .returning({ id: users.id });

    if (approved) {
      const [azentio] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.kind, "azentio"));
      if (azentio) {
        await tx.insert(memberships).values({
          userId: created.id,
          orgId: azentio.id,
          role: "employee",
          status: "active",
          approvedBy: approved.approvedBy,
          termsAcceptedAt: now,
        });
      }
    }
    // A client invitee gets a verified user but NO membership until they accept their invitation.
    return created.id;
  });
}
