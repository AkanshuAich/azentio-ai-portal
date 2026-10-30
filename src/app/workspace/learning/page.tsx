import { ClientShell } from "@/components/portal/ClientShell";
import { FeedView } from "@/components/learning/FeedView";
import { guardClient } from "@/lib/auth/pages";
import { dbAuditSink } from "@/lib/audit/log";
import { getDb } from "@/lib/db";
import { unreadCount } from "@/lib/notifications/inapp";

export const metadata = { title: "Shared learning | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function LearningPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const db = getDb();
  return (
    <ClientShell session={g.session} active="learning" unread={await unreadCount(db, g.session.user.id)} title="Shared learning"
      lead="Approved, de-identified observations from across the community. Search them, see the themes, or ask AIRA.">
      <FeedView db={db} principal={g.session.principal} audit={dbAuditSink(db)} raw={await searchParams} base="/workspace/learning" />
    </ClientShell>
  );
}
