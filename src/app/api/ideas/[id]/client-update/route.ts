import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { publishClientUpdate } from "@/lib/learning/ideas";

// Publishes an approved plain-language summary to clients and notifies the supporting contributors.
export const POST = authedRoute(async (req, { db, session, audit, params }) =>
  NextResponse.json({ ok: true, ...(await publishClientUpdate(db, session.principal, audit, params.id, await req.json())) }),
);
