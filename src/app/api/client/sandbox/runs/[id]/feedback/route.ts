import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { saveSandboxFeedback } from "@/lib/client/service";

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  await saveSandboxFeedback(db, session.principal, audit, params.id, await req.json());
  return NextResponse.json({ ok: true });
});
