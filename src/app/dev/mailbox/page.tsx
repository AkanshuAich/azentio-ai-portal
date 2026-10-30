import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { outboxMessages } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * Development-only view of the outbox, standing in for a real mail provider. It does not exist in
 * production: no mail has left this machine, which is why the state column never says "delivered".
 */
export default async function DevMailbox() {
  if (process.env.NODE_ENV === "production") notFound();
  const rows = await getDb().select().from(outboxMessages).orderBy(desc(outboxMessages.at)).limit(25);
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-ink">Dev mailbox</h1>
      <p className="mt-1 text-sm text-muted">Local outbox. Nothing here was emailed.</p>
      <ul className="mt-6 space-y-4">
        {rows.map((m) => (
          <li key={m.id} className="rounded-az-lg border border-panel p-4">
            <div className="flex justify-between text-xs text-muted"><span>To: {m.toEmail}</span><span>{m.state}</span></div>
            <p className="mt-1 font-semibold text-ink">{m.subject}</p>
            <p className="mt-1 break-words text-sm text-text">{m.body}</p>
          </li>
        ))}
        {rows.length === 0 && <li className="text-muted">No messages yet.</li>}
      </ul>
    </main>
  );
}
