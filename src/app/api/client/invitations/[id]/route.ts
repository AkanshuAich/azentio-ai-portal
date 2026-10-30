import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { cancelInvitation } from "@/lib/client/service";

export const DELETE = authedRoute(async (_req, { db, session, audit, params }) => {
  await cancelInvitation(db, session.principal, audit, params.id);
  return NextResponse.json({ ok: true });
});
