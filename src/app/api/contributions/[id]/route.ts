import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { getContribution, updateContribution } from "@/lib/learning/contributions";

export const GET = authedRoute(
  async (_req, { db, session, audit, params }) => NextResponse.json(await getContribution(db, session.principal, audit, params.id)),
  { mutating: false },
);

// Editing a published item is a material edit: it becomes a new version that is re-reviewed.
export const PATCH = authedRoute(async (req, { db, session, audit, params }) => {
  return NextResponse.json({ ok: true, ...(await updateContribution(db, session.principal, audit, params.id, await req.json())) });
});
