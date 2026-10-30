import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { createSupportRequest, listSupportRequests } from "@/lib/client/collab";
import { requireClientTenant } from "@/lib/client/service";

export const GET = authedRoute(
  async (_req, { db, session, audit }) => {
    await requireClientTenant(session.principal, audit);
    return NextResponse.json(await listSupportRequests(db, session.principal));
  },
  { mutating: false },
);

export const POST = authedRoute(async (req, { db, session, audit }) => {
  const id = await createSupportRequest(db, session.principal, audit, await req.json());
  return NextResponse.json({ ok: true, id }, { status: 201 });
});
