import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { createIdea, listIdeas } from "@/lib/learning/ideas";

// Needs the ideas.manage grant, which is separate from being an employee or a moderator.
export const GET = authedRoute(
  async (_req, { db, session, audit }) => NextResponse.json(await listIdeas(db, session.principal, audit)),
  { mutating: false },
);

export const POST = authedRoute(async (req, { db, session, audit }) =>
  NextResponse.json({ ok: true, id: await createIdea(db, session.principal, audit, await req.json()) }, { status: 201 }),
);
