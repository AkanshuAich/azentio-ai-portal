import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { deleteSavedSearch } from "@/lib/learning/feed";

export const DELETE = authedRoute(async (_req, { db, session, params }) => {
  await deleteSavedSearch(db, session.principal, params.id);
  return NextResponse.json({ ok: true });
});
