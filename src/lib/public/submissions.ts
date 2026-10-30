import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { demoEnquiries, hackathonRegistrations } from "@/lib/db/schema";
import { getPublicProduct } from "./products";
import type { DemoEnquiryInput, HackathonInput } from "@/lib/validation/forms";

export const MAX_ENQUIRIES_PER_EMAIL_PER_HOUR = 3;
const HOUR = 60 * 60 * 1000;

export type SubmissionOutcome = "stored" | "duplicate" | "rate_limited" | "ignored";

/**
 * Records a demo enquiry. A filled honeypot is dropped silently, and rate-limited or repeated
 * submissions return the same success to the visitor, so the form can't be probed for state.
 * "stored" means the enquiry is saved for the team. It does not mean anyone has been emailed.
 */
export async function createEnquiry(db: Db, input: DemoEnquiryInput, now = new Date()): Promise<SubmissionOutcome> {
  if (input.website) return "ignored";

  const since = new Date(now.getTime() - HOUR);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(demoEnquiries)
    .where(and(eq(demoEnquiries.email, input.email), gt(demoEnquiries.createdAt, since)));
  if (n >= MAX_ENQUIRIES_PER_EMAIL_PER_HOUR) return "rate_limited";

  // Only a product that is actually public may be referenced; anything else is dropped, not echoed.
  const product = input.productSlug ? await getPublicProduct(db, input.productSlug) : null;

  await db.insert(demoEnquiries).values({
    name: input.name,
    email: input.email,
    organisation: input.organisation,
    role: input.role ?? null,
    productSlug: product?.slug ?? null,
    message: input.message,
    contactConsent: input.contactConsent,
    createdAt: now,
  });
  return "stored";
}

export async function registerForHackathon(db: Db, input: HackathonInput, now = new Date()): Promise<SubmissionOutcome> {
  if (input.website) return "ignored";

  const [existing] = await db
    .select({ id: hackathonRegistrations.id })
    .from(hackathonRegistrations)
    .where(eq(hackathonRegistrations.email, input.email));
  if (existing) return "duplicate";

  await db.insert(hackathonRegistrations).values({
    name: input.name,
    email: input.email,
    organisation: input.organisation ?? null,
    interest: input.interest,
    contactConsent: input.contactConsent,
    createdAt: now,
  });
  return "stored";
}
