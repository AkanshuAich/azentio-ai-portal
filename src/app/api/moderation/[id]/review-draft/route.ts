import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { saveReviewDraft } from "@/lib/learning/moderation";

const Body = z.object({ reviewed: z.unknown(), privateNotes: z.string().max(2000).optional() });

// Saves the reviewed (redacted) copy. The shared version is built from this copy only.
export const PUT = authedRoute(async (req, { db, session, audit, params }) => {
  const { reviewed, privateNotes } = Body.parse(await req.json());
  return NextResponse.json({ ok: true, ...(await saveReviewDraft(db, session.principal, audit, params.id, reviewed, privateNotes)) });
});
