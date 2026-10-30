import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { giveFeedback } from "@/lib/learning/feed";

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  const { value } = z.object({ value: z.string() }).parse(await req.json());
  await giveFeedback(db, session.principal, audit, params.id, value);
  return NextResponse.json({ ok: true });
});
