import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { startRun } from "@/lib/federated/service";

// Needs federated.coordinate. Produces a CANDIDATE model only; deploying is a separate, two-person decision.
export const POST = authedRoute(async (req, { db, session, audit }) =>
  NextResponse.json(await startRun(db, session.principal, audit, await req.json()), { status: 201 }),
);
