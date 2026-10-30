import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { listBookmarks, toggleBookmark } from "@/lib/client/collab";
import { requireClientTenant } from "@/lib/client/service";

export const GET = authedRoute(
  async (_req, { db, session, audit }) => {
    await requireClientTenant(session.principal, audit);
    return NextResponse.json(await listBookmarks(db, session.principal));
  },
  { mutating: false },
);

export const POST = authedRoute(async (req, { db, session, audit }) => {
  const { type, id } = z.object({ type: z.string(), id: z.string() }).parse(await req.json());
  return NextResponse.json({ ok: true, ...(await toggleBookmark(db, session.principal, audit, type, id)) });
});
