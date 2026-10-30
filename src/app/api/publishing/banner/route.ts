import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { setBanner } from "@/lib/employee/service";

export const POST = authedRoute(async (req, { db, session, audit }) => {
  await setBanner(db, session.principal, audit, await req.json());
  return NextResponse.json({ ok: true });
});
