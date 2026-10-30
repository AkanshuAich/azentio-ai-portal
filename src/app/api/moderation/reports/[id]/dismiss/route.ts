import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { dismissReport } from "@/lib/learning/moderation";

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  const { reason } = z.object({ reason: z.unknown() }).parse(await req.json());
  await dismissReport(db, session.principal, audit, params.id, { reason });
  return NextResponse.json({ ok: true });
});
