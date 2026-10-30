import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { getIdea, updateIdeaStatus } from "@/lib/learning/ideas";

export const GET = authedRoute(
  async (_req, { db, session, audit, params }) => NextResponse.json(await getIdea(db, session.principal, audit, params.id)),
  { mutating: false },
);

// Status changes are audited with their from and to.
export const PATCH = authedRoute(async (req, { db, session, audit, params }) => {
  const { status } = z.object({ status: z.unknown() }).parse(await req.json());
  await updateIdeaStatus(db, session.principal, audit, params.id, status);
  return NextResponse.json({ ok: true });
});
