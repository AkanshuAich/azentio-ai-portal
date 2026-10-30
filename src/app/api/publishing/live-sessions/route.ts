import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { createLiveSession } from "@/lib/employee/service";

// Requires the media.publish grant: being an employee is not enough to configure broadcasts.
export const POST = authedRoute(async (req, { db, session, audit }) => {
  const id = await createLiveSession(db, session.principal, audit, await req.json());
  return NextResponse.json({ ok: true, id }, { status: 201 });
});
