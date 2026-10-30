import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { giveArticleFeedback } from "@/lib/employee/service";

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  await giveArticleFeedback(db, session.principal, audit, params.id, await req.json());
  return NextResponse.json({ ok: true });
});
