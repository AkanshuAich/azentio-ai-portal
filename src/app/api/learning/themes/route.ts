import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { listThemes } from "@/lib/learning/themes";

export const GET = authedRoute(
  async (_req, { db, session, audit }) => NextResponse.json(await listThemes(db, session.principal, audit)),
  { mutating: false },
);
