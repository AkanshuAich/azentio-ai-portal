import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { enrol } from "@/lib/federated/service";

// A client administrator enrols their OWN organisation (taken from the session) with an explicit acknowledgement.
export const POST = authedRoute(async (req, { db, session, audit }) => {
  await enrol(db, session.principal, audit, await req.json());
  return NextResponse.json({ ok: true }, { status: 201 });
});
