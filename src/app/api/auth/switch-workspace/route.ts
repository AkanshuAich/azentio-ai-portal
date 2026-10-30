import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, readCookieToken } from "@/lib/auth/http";
import { loadSession, switchWorkspace } from "@/lib/auth/session";
import { landingFor } from "@/lib/auth/landing";

const Body = z.object({ orgId: z.string().uuid() });

export const POST = authedRoute(async (req, { db, session, audit }) => {
  const { orgId } = Body.parse(await req.json());
  const token = (await readCookieToken())!;
  // Allowed only into a workspace the caller already holds an active, terms-accepted membership in.
  if (!(await switchWorkspace(db, token, orgId))) {
    await audit({ actorId: session.user.id, action: "read", subjectType: "workspace_switch", subjectId: orgId, orgId: null, allowed: false, reason: "no active, terms-accepted membership in that workspace" });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ctx = await loadSession(db, token);
  return NextResponse.json({ ok: true, next: ctx ? landingFor(ctx) : "/" });
});
