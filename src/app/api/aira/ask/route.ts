import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { askAira } from "@/lib/aira/answer";

// Signed-in AIRA: answers only from approved shared observations the caller may see. The public site's
// AIRA is a separate route that reads public pages only.
export const POST = authedRoute(async (req, { db, session, audit }) => {
  const { question } = z.object({ question: z.unknown() }).parse(await req.json());
  return NextResponse.json(await askAira(db, session.principal, audit, question));
});
