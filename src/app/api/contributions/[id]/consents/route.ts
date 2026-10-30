import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { setConsents } from "@/lib/learning/contributions";

export const PATCH = authedRoute(async (req, { db, session, audit, params }) =>
  NextResponse.json({ ok: true, ...(await setConsents(db, session.principal, audit, params.id, await req.json())) }),
);
