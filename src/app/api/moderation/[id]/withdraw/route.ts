import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { withdrawByModerator } from "@/lib/learning/moderation";

// Only from a paused item: urgent removal is unpublish first, then withdraw, so each step is recorded.
export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  const { reason } = z.object({ reason: z.unknown() }).parse(await req.json());
  return NextResponse.json({ ok: true, ...(await withdrawByModerator(db, session.principal, audit, params.id, { reason })) });
});
