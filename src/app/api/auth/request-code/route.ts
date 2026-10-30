import { NextResponse } from "next/server";
import { z } from "zod";
import { publicRoute } from "@/lib/auth/http";
import { requestCode } from "@/lib/auth/otp";
import { getDb } from "@/lib/db";

const Body = z.object({ email: z.string().max(254) });

export const POST = publicRoute("sign-in starts unauthenticated; the response is identical for every address", async (req) => {
  const { email } = Body.parse(await req.json());
  try {
    await requestCode(getDb(), email);
  } catch (e) {
    // A transport failure must not reveal whether the address was eligible.
    console.error("request-code failed", e);
  }
  return NextResponse.json({ ok: true });
});
