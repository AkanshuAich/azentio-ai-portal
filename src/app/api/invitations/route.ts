import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { createInvitation } from "@/lib/auth/invitations";

// Role is validated against the policy engine, not here: this only constrains the shape.
const Body = z.object({
  email: z.string().max(254),
  role: z.enum(["client_member", "client_admin", "employee"]),
});

export const POST = authedRoute(async (req, { db, session, audit }) => {
  const { email, role } = Body.parse(await req.json());
  // The target organisation is the caller's ACTIVE workspace from the session. A client-supplied
  // tenant id is never read (IAM-01).
  const orgId = session.principal.activeOrgId;
  if (!orgId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { invitationId } = await createInvitation(db, session.principal, audit, { orgId, email, role });
  // The token is deliberately not returned: it travels only in the invitation email.
  return NextResponse.json({ ok: true, invitationId }, { status: 201 });
});
