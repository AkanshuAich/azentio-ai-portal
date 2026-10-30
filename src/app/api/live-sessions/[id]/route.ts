import { NextResponse } from "next/server";
import { policyRoute } from "@/lib/auth/http";
import { getLiveSession } from "@/lib/employee/service";

// Knowing a session's URL grants nothing: the stream reference is returned only if the audience permits it.
export const GET = policyRoute(async (_req, { db, session, params }) => {
  const row = await getLiveSession(db, session?.principal ?? null, params.id);
  if (row === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row === "forbidden") return NextResponse.json({ error: session ? "forbidden" : "unauthenticated" }, { status: session ? 403 : 401 });
  return NextResponse.json({ id: row.id, title: row.title, startsAt: row.startsAt, streamRef: row.streamRef, recordingAssetId: row.recordingAssetId, audience: row.audience });
});
