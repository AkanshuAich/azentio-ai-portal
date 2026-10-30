import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { reportComment } from "@/lib/client/collab";

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  await reportComment(db, session.principal, audit, params.id, await req.json());
  return NextResponse.json({ ok: true }, { status: 201 });
});
