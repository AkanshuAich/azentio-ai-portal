import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { runScenario } from "@/lib/employee/service";

const Body = z.object({ scenarioId: z.string().max(80), params: z.record(z.string(), z.unknown()) });

export const POST = authedRoute(async (req, { db, session, audit }) => {
  const { scenarioId, params } = Body.parse(await req.json());
  const { id, output } = await runScenario(db, session.principal, audit, scenarioId, params);
  return NextResponse.json({ id, output });
});
