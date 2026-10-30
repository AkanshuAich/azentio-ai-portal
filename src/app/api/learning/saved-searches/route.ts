import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { listSavedSearches, requireParticipant, saveSearch } from "@/lib/learning/feed";

export const GET = authedRoute(
  async (_req, { db, session, audit }) => {
    await requireParticipant(session.principal, audit, "saved_search");
    return NextResponse.json(await listSavedSearches(db, session.principal));
  },
  { mutating: false },
);

export const POST = authedRoute(async (req, { db, session, audit }) =>
  NextResponse.json({ ok: true, id: await saveSearch(db, session.principal, audit, await req.json()) }, { status: 201 }),
);
