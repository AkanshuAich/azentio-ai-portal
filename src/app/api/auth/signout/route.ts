import { NextResponse } from "next/server";
import { clearSessionCookie, publicRoute, readCookieToken } from "@/lib/auth/http";
import { destroySession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const POST = publicRoute("signing out must work even when the session is already gone", async () => {
  await destroySession(getDb(), await readCookieToken());
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
