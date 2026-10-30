import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { rejectContribution } from "@/lib/learning/moderation";

const Body = z.object({ reason: z.unknown(), privateNotes: z.string().max(2000).optional() });

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  const { reason, privateNotes } = Body.parse(await req.json());
  await rejectContribution(db, session.principal, audit, params.id, { reason }, privateNotes);
  return NextResponse.json({ ok: true });
});
