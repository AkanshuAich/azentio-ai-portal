import { NextResponse } from "next/server";
import { z } from "zod";
import { publicRoute, setSessionCookie } from "@/lib/auth/http";
import { verifyCode } from "@/lib/auth/otp";
import { createSession, loadSession } from "@/lib/auth/session";
import { landingFor } from "@/lib/auth/landing";
import { getDb } from "@/lib/db";

const Body = z.object({ email: z.string().max(254), code: z.string().max(12) });

export const POST = publicRoute("completes sign-in by proving possession of an emailed code", async (req) => {
  const { email, code } = Body.parse(await req.json());
  const db = getDb();
  const userId = await verifyCode(db, email, code);
  if (!userId) return NextResponse.json({ error: "invalid_code" }, { status: 401 });

  const { token, expiresAt } = await createSession(db, userId);
  await setSessionCookie(token, expiresAt);
  const ctx = await loadSession(db, token);
  return NextResponse.json({ ok: true, next: ctx ? landingFor(ctx) : "/" });
});
