import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { linkThemeEvidence, unlinkThemeEvidence } from "@/lib/learning/themes";

const Body = z.object({ publicationId: z.string().uuid(), action: z.enum(["link", "unlink"]) });

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  const { publicationId, action } = Body.parse(await req.json());
  if (action === "link") await linkThemeEvidence(db, session.principal, audit, params.id, publicationId);
  else await unlinkThemeEvidence(db, session.principal, audit, params.id, publicationId);
  return NextResponse.json({ ok: true });
});
