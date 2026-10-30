import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { setTeamMembership } from "@/lib/employee/service";

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  const { action } = z.object({ action: z.enum(["join", "leave"]) }).parse(await req.json());
  await setTeamMembership(db, session.principal, audit, params.id, action);
  return NextResponse.json({ ok: true });
});
