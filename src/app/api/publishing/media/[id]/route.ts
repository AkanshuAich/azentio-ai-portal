import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { setMediaAudience } from "@/lib/employee/service";

const Body = z.object({ audience: z.string(), orgId: z.string().optional(), productSlug: z.string().optional() });

export const PATCH = authedRoute(async (req, { db, session, audit, params }) => {
  const { audience, orgId, productSlug } = Body.parse(await req.json());
  await setMediaAudience(db, session.principal, audit, params.id, audience, { orgId, productSlug });
  return NextResponse.json({ ok: true });
});
