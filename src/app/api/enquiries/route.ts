import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/auth/http";
import { getDb } from "@/lib/db";
import { createEnquiry } from "@/lib/public/submissions";
import { demoEnquirySchema } from "@/lib/validation/forms";

export const POST = publicRoute("public visitors may request a demo without signing in", async (req) => {
  const parsed = demoEnquirySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  await createEnquiry(getDb(), parsed.data);
  // Identical for stored, repeated, limited and ignored submissions.
  return NextResponse.json({ ok: true }, { status: 201 });
});
