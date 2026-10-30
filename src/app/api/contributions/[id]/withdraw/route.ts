import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { withdrawMine } from "@/lib/learning/contributions";

// Synchronous: when this returns, the item is gone from search, the index, cached themes and AIRA retrieval.
export const POST = authedRoute(async (_req, { db, session, audit, params }) =>
  NextResponse.json({ ok: true, ...(await withdrawMine(db, session.principal, audit, params.id)) }),
);
