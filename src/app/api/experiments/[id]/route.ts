import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { setExperimentStatus } from "@/lib/employee/service";

export const PATCH = authedRoute(async (req, { db, session, audit, params }) => {
  const { status } = z.object({ status: z.string() }).parse(await req.json());
  await setExperimentStatus(db, session.principal, audit, params.id, status);
  return NextResponse.json({ ok: true });
});
