import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { searchFeed } from "@/lib/learning/feed";

// Search, counts and facets all use the same visibility rule as the underlying records.
export const GET = authedRoute(
  async (req, { db, session, audit }) => NextResponse.json(await searchFeed(db, session.principal, audit, Object.fromEntries(new URL(req.url).searchParams))),
  { mutating: false },
);
