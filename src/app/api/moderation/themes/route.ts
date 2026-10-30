import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { createTheme } from "@/lib/learning/themes";

export const POST = authedRoute(async (req, { db, session, audit }) =>
  NextResponse.json({ ok: true, id: await createTheme(db, session.principal, audit, await req.json()) }, { status: 201 }),
);
