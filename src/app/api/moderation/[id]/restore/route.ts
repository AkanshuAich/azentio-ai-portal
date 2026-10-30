import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { restore } from "@/lib/learning/moderation";

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  const { reason } = z.object({ reason: z.unknown() }).parse(await req.json());
  await restore(db, session.principal, audit, params.id, { reason });
  return NextResponse.json({ ok: true });
});
