import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/auth/http";
import { getDb } from "@/lib/db";
import { registerForHackathon } from "@/lib/public/submissions";
import { hackathonSchema } from "@/lib/validation/forms";

export const POST = publicRoute("public visitors may register hackathon interest without signing in", async (req) => {
  const parsed = hackathonSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  await registerForHackathon(getDb(), parsed.data);
  return NextResponse.json({ ok: true }, { status: 201 });
});
