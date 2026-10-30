import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { decide } from "@/lib/federated/service";

// Needs federated.approve, and the approver must be someone other than whoever registered the model.
export const POST = authedRoute(async (req, { db, session, audit, params }) =>
  NextResponse.json({ ok: true, ...(await decide(db, session.principal, audit, params.id, await req.json())) }),
);
