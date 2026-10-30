import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { openReview } from "@/lib/learning/moderation";

// Opening a private source for review is an audited act.
export const GET = authedRoute(
  async (_req, { db, session, audit, params }) => NextResponse.json(await openReview(db, session.principal, audit, params.id)),
  { mutating: false },
);
