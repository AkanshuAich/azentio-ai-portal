import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/auth/http";
import { addComment, listComments } from "@/lib/client/collab";

export const GET = authedRoute(
  async (req, { db, session, audit }) => {
    const u = new URL(req.url);
    return NextResponse.json(await listComments(db, session.principal, audit, u.searchParams.get("parentType"), u.searchParams.get("parentId") ?? ""));
  },
  { mutating: false },
);

export const POST = authedRoute(async (req, { db, session, audit }) => {
  const id = await addComment(db, session.principal, audit, await req.json());
  return NextResponse.json({ ok: true, id }, { status: 201 });
});
