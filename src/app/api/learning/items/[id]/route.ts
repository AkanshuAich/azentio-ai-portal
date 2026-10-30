import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { getPublication } from "@/lib/learning/feed";

export const GET = authedRoute(
  async (_req, { db, session, audit, params }) => NextResponse.json(await getPublication(db, session.principal, audit, params.id)),
  { mutating: false },
);
