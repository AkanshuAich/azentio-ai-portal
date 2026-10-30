import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { withdraw } from "@/lib/federated/service";

// Withdrawal stops future participation and flags affected models for review. It does not untrain them.
export const POST = authedRoute(async (_req, { db, session, audit }) =>
  NextResponse.json({ ok: true, ...(await withdraw(db, session.principal, audit)) }),
);
