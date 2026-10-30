import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { reportPublication } from "@/lib/learning/feed";

// The reporter's identity is stored for the moderator's records only and is never returned to the contributor.
export const POST = authedRoute(async (req, { db, session, audit, params }) =>
  NextResponse.json({ ok: true, ...(await reportPublication(db, session.principal, audit, params.id, await req.json())) }, { status: 201 }),
);
