import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";

/**
 * In-app notifications are persisted rows, readable only by their recipient. A stored notification means
 * "the user will see this in the portal". It does not mean an email was delivered.
 */
export async function notify(db: Db, userId: string, message: string, href?: string) {
  await db.insert(notifications).values({ userId, message, href: href ?? null });
}

export async function listNotifications(db: Db, userId: string, limit = 50) {
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.at)).limit(limit);
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return n;
}

/** Marks one notification (or all) read, but only ever the caller's own. */
export async function markRead(db: Db, userId: string, id?: string, now = new Date()) {
  const scope = id
    ? and(eq(notifications.userId, userId), eq(notifications.id, id), isNull(notifications.readAt))
    : and(eq(notifications.userId, userId), isNull(notifications.readAt));
  const rows = await db.update(notifications).set({ readAt: now }).where(scope).returning({ id: notifications.id });
  return rows.length;
}
