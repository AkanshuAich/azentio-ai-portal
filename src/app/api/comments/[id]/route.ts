import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { hideComment } from "@/lib/client/collab";

export const DELETE = authedRoute(async (_req, { db, session, audit, params }) => {
  await hideComment(db, session.principal, audit, params.id);
  return NextResponse.json({ ok: true });
});
