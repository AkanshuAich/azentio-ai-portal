import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { linkIdeaEvidence, unlinkIdeaEvidence } from "@/lib/learning/ideas";

const Body = z.object({ publicationId: z.string().uuid(), action: z.enum(["link", "unlink"]) });

export const POST = authedRoute(async (req, { db, session, audit, params }) => {
  const { publicationId, action } = Body.parse(await req.json());
  if (action === "link") await linkIdeaEvidence(db, session.principal, audit, params.id, publicationId);
  else await unlinkIdeaEvidence(db, session.principal, audit, params.id, publicationId);
  return NextResponse.json({ ok: true });
});
