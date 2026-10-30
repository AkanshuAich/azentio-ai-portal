import { NextResponse } from "next/server";
import { z } from "zod";
import { publicRoute } from "@/lib/auth/http";
import { MAX_QUESTION_LENGTH, answerPublicQuestion } from "@/lib/aira/public";
import { getDb } from "@/lib/db";

const Body = z.object({ question: z.string().trim().min(2).max(MAX_QUESTION_LENGTH) });

// Answers from public content only, so it needs no sign-in. Signed-in AIRA is a separate, audience-aware route.
export const POST = publicRoute("anonymous visitors may ask questions answered from public pages only", async (req) => {
  const { question } = Body.parse(await req.json());
  return NextResponse.json(await answerPublicQuestion(getDb(), question));
});
