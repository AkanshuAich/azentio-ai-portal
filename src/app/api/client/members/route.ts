import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { listMembers } from "@/lib/client/service";

export const GET = authedRoute(
  async (_req, { db, session, audit }) => NextResponse.json(await listMembers(db, session.principal, audit)),
  { mutating: false },
);
