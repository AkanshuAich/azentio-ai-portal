import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/lib/auth/http";
import { listNotifications, markRead, unreadCount } from "@/lib/notifications/inapp";

// Notifications belong to the signed-in user alone: every query is scoped to the session's user id.
export const GET = authedRoute(
  async (_req, { db, session }) =>
    NextResponse.json({ unread: await unreadCount(db, session.user.id), items: await listNotifications(db, session.user.id) }),
  { mutating: false },
);

export const POST = authedRoute(async (req, { db, session }) => {
  const { id } = z.object({ id: z.string().uuid().optional() }).parse(await req.json());
  return NextResponse.json({ ok: true, marked: await markRead(db, session.user.id, id) });
});
