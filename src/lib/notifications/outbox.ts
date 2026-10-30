import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { outboxMessages } from "@/lib/db/schema";

export interface OutgoingEmail {
  toEmail: string;
  toUserId?: string | null;
  subject: string;
  body: string;
  /** True when the body carries a secret (sign-in code, invitation link). */
  secret: boolean;
  /** Same key, same message: retries and double-submits never send twice. */
  idempotencyKey: string;
}

/**
 * Persist first, then dispatch. A stored row is "queued", never "delivered": the only states are
 * queued, dev_logged (printed locally, no email left this machine) and sent (handed to a provider).
 * Provider-backed delivery is a P1 item; until an adapter is wired in, production refuses to pretend.
 */
export async function queueEmail(db: Db, msg: OutgoingEmail): Promise<{ id: string; created: boolean }> {
  const inserted = await db
    .insert(outboxMessages)
    .values({
      idempotencyKey: msg.idempotencyKey,
      toEmail: msg.toEmail,
      toUserId: msg.toUserId ?? null,
      subject: msg.subject,
      body: msg.body,
      state: "queued",
    })
    .onConflictDoNothing({ target: outboxMessages.idempotencyKey })
    .returning({ id: outboxMessages.id });

  if (inserted.length === 0) {
    const [existing] = await db
      .select({ id: outboxMessages.id })
      .from(outboxMessages)
      .where(eq(outboxMessages.idempotencyKey, msg.idempotencyKey));
    return { id: existing.id, created: false };
  }

  const id = inserted[0].id;
  await dispatch(db, id);
  return { id, created: true };
}

async function dispatch(db: Db, id: string) {
  const transport = process.env.MAIL_TRANSPORT ?? "dev";
  if (transport === "dev") {
    if (process.env.NODE_ENV === "production") {
      // Leave the row queued rather than claim anything about delivery.
      throw new Error("No mail transport configured for production (set MAIL_TRANSPORT)");
    }
    await db.update(outboxMessages).set({ state: "dev_logged" }).where(eq(outboxMessages.id, id));
    return;
  }
  throw new Error(`Unknown MAIL_TRANSPORT "${transport}": add a provider adapter in outbox.ts`);
}
