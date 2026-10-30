import { NextResponse } from "next/server";
import { policyRoute } from "@/lib/auth/http";
import { listLiveSessions } from "@/lib/employee/service";

// Each session is filtered by its own audience: an anonymous caller sees only explicitly public sessions,
// a client sees none of the employee ones, and employee sessions are returned only to employees.
export const GET = policyRoute(async (_req, { db, session }) => {
  const rows = await listLiveSessions(db, session?.principal ?? null);
  return NextResponse.json(rows.map((r) => ({ id: r.id, title: r.title, startsAt: r.startsAt, audience: r.audience, hasRecording: r.recordingAssetId !== null })));
});
