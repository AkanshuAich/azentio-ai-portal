import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { listSavedScenarios, requireClientTenant, saveScenario } from "@/lib/client/service";

export const GET = authedRoute(
  async (_req, { db, session, audit }) => {
    await requireClientTenant(session.principal, audit);
    return NextResponse.json(await listSavedScenarios(db, session.principal));
  },
  { mutating: false },
);

export const POST = authedRoute(async (req, { db, session, audit }) => {
  const id = await saveScenario(db, session.principal, audit, await req.json());
  return NextResponse.json({ ok: true, id }, { status: 201 });
});
