import { ClientShell } from "@/components/portal/ClientShell";
import { ThemeCards } from "@/components/learning/ThemeCards";
import { guardClient } from "@/lib/auth/pages";
import { dbAuditSink } from "@/lib/audit/log";
import { listThemes } from "@/lib/learning/themes";
import { getDb } from "@/lib/db";
import { unreadCount } from "@/lib/notifications/inapp";

export const metadata = { title: "Themes | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function ThemesPage() {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const db = getDb();
  const themes = await listThemes(db, g.session.principal, dbAuditSink(db));
  return (
    <ClientShell session={g.session} active="themes" unread={await unreadCount(db, g.session.user.id)} title="Themes"
      lead="Recurring patterns across approved observations. Strength is the number of different organisations, never the number of posts.">
      <ThemeCards themes={themes} />
    </ClientShell>
  );
}
