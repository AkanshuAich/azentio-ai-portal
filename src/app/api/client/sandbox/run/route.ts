import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { runSandbox } from "@/lib/client/service";

const Body = z.object({ scenarioId: z.string().max(80), params: z.record(z.string(), z.unknown()) });

// The organisation comes from the session's active workspace; a tenant id in the body is never read.
export const POST = authedRoute(async (req, { db, session, audit }) => {
  const { scenarioId, params } = Body.parse(await req.json());
  const { id, output } = await runSandbox(db, session.principal, audit, scenarioId, params);
  return NextResponse.json({ id, output });
});
