import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { publishReviewed } from "@/lib/learning/moderation";

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  const { confirmReviewedCopyIsSafe } = z.object({ confirmReviewedCopyIsSafe: z.boolean().optional() }).parse(await req.json().catch(() => ({})));
  return NextResponse.json({ ok: true, ...(await publishReviewed(db, session.principal, audit, params.id, { confirmReviewedCopyIsSafe })) });
});
