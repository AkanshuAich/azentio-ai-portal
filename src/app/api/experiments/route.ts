import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { assertEmployee, createExperiment, listExperiments } from "@/lib/employee/service";

export const GET = authedRoute(
  async (_req, { db, session, audit }) => {
    await assertEmployee(session.principal, audit);
    return NextResponse.json(await listExperiments(db, session.principal));
  },
  { mutating: false },
);

export const POST = authedRoute(async (req, { db, session, audit }) => {
  const id = await createExperiment(db, session.principal, audit, await req.json());
  return NextResponse.json({ ok: true, id }, { status: 201 });
});
