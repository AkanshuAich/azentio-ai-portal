import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { setMediaAudience } from "@/lib/employee/service";

export const PATCH = authedRoute(async (req, { db, session, audit, params }) => {
  const { audience } = z.object({ audience: z.string() }).parse(await req.json());
  await setMediaAudience(db, session.principal, audit, params.id, audience);
  return NextResponse.json({ ok: true });
});
