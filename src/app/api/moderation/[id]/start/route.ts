import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { startReview } from "@/lib/learning/moderation";

export const POST = authedRoute(async (_req, { db, session, audit, params }) => {
  await startReview(db, session.principal, audit, params.id);
  return NextResponse.json({ ok: true });
});
