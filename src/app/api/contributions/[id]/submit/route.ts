import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { submitContribution } from "@/lib/learning/contributions";

export const POST = authedRoute(async (_req, { db, session, audit, params }) =>
  NextResponse.json({ ok: true, ...(await submitContribution(db, session.principal, audit, params.id)) }),
);
