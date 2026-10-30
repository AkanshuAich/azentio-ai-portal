import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { changeMemberRole, revokeMember } from "@/lib/client/service";

// Role is validated by the policy engine: a client administrator can only grant client roles, in their own organisation.
export const PATCH = authedRoute(async (req, { db, session, audit, params }) => {
  const { role } = z.object({ role: z.string() }).parse(await req.json());
  await changeMemberRole(db, session.principal, audit, params.userId, role);
  return NextResponse.json({ ok: true });
});

export const DELETE = authedRoute(async (_req, { db, session, audit, params }) => {
  await revokeMember(db, session.principal, audit, params.userId);
  return NextResponse.json({ ok: true });
});
