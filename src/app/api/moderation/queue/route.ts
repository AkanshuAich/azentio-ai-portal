import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { listQueue } from "@/lib/learning/moderation";

// Needs the learning.moderate grant: being an employee is not enough.
export const GET = authedRoute(
  async (_req, { db, session, audit }) => NextResponse.json(await listQueue(db, session.principal, audit)),
  { mutating: false },
);
