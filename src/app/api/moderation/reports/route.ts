import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { listOpenReports } from "@/lib/learning/moderation";

// Reports are returned without the reporter's identity or organisation.
export const GET = authedRoute(
  async (_req, { db, session, audit }) => NextResponse.json(await listOpenReports(db, session.principal, audit)),
  { mutating: false },
);
