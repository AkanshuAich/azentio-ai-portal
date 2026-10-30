import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { shareWithOrganisation } from "@/lib/learning/contributions";

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  const { share } = z.object({ share: z.boolean() }).parse(await req.json());
  await shareWithOrganisation(db, session.principal, audit, params.id, share);
  return NextResponse.json({ ok: true });
});
