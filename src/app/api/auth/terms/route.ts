import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, readCookieToken } from "@/lib/auth/http";
import { acceptTerms, loadSession, switchWorkspace } from "@/lib/auth/session";
import { landingFor } from "@/lib/auth/landing";

const Body = z.object({ orgId: z.string().uuid(), acknowledged: z.literal(true) });

/**
 * Records acceptance of the workspace terms and the learning-sharing explanation for the caller's own
 * membership. This is deliberately NOT consent to share or to train on any data (§04, §09).
 */
export const POST = authedRoute(async (req, { db, session }) => {
  const { orgId } = Body.parse(await req.json());
  const owns = session.workspaces.some((w) => w.orgId === orgId);
  if (!owns || !(await acceptTerms(db, session.user.id, orgId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const token = (await readCookieToken())!;
  const fresh = await loadSession(db, token);
  // One usable workspace becomes active automatically; with several the user still chooses.
  if (fresh && fresh.workspaces.filter((w) => w.termsAccepted).length === 1) await switchWorkspace(db, token, orgId);
  const after = await loadSession(db, token);
  return NextResponse.json({ ok: true, next: after ? landingFor(after) : "/" });
});
