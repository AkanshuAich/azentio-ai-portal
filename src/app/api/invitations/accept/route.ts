import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, readCookieToken } from "@/lib/auth/http";
import { acceptInvitation } from "@/lib/auth/invitations";
import { loadSession } from "@/lib/auth/session";
import { landingFor } from "@/lib/auth/landing";

const Body = z.object({ token: z.string().min(20).max(200) });

export const POST = authedRoute(async (req, { db, session, audit }) => {
  const { token } = Body.parse(await req.json());
  // Accepts only for the signed-in, verified account the invitation was issued to.
  await acceptInvitation(db, token, session.user.id, audit);
  const fresh = await loadSession(db, (await readCookieToken())!);
  return NextResponse.json({ ok: true, next: fresh ? landingFor(fresh) : "/" });
});
