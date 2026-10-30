import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { listClientResources } from "@/lib/client/service";

export const GET = authedRoute(
  async (_req, { db, session, audit }) => NextResponse.json(await listClientResources(db, session.principal, audit)),
  { mutating: false },
);
