import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { suggest } from "@/lib/learning/feed";

export const GET = authedRoute(
  async (req, { db, session, audit }) => NextResponse.json(await suggest(db, session.principal, audit, new URL(req.url).searchParams.get("q") ?? "")),
  { mutating: false },
);
