import Link from "next/link";
import { Card, Empty } from "@/components/portal/EmployeeShell";
import { ClientShell } from "@/components/portal/ClientShell";
import { AudienceBanner, StatusBadge } from "@/components/learning/badges";
import { guardClient } from "@/lib/auth/pages";
import { listMine, listOrganisation, type ContributionSummary } from "@/lib/learning/contributions";
import { KIND_LABEL } from "@/lib/learning/validation";
import { getDb } from "@/lib/db";
import { unreadCount } from "@/lib/notifications/inapp";

export const metadata = { title: "My observations | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function ObservationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const { tab } = await searchParams;
  const org = tab === "org";
  const db = getDb();
  const rows: ContributionSummary[] = org ? await listOrganisation(db, g.session.principal) : await listMine(db, g.session.principal);
  const unread = await unreadCount(db, g.session.user.id);

  const tabClass = (on: boolean) => `rounded-full px-5 py-2 text-sm font-semibold ${on ? "bg-[var(--az-cta-dark)] text-white" : "bg-panel text-ink hover:bg-mint"}`;

  return (
    <ClientShell session={g.session} active="observations" unread={unread} title="Observations"
      lead="Share what you're seeing in the market. Everything starts as a private draft, and nothing is shared until you choose and a moderator approves.">
      <AudienceBanner kind="private" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2" role="tablist">
          <Link href="/workspace/observations" className={tabClass(!org)} role="tab" aria-selected={!org}>My observations</Link>
          <Link href="/workspace/observations?tab=org" className={tabClass(org)} role="tab" aria-selected={org}>Our organisation&apos;s observations</Link>
        </div>
        <Link href="/workspace/observations/new" className="rounded-full bg-mint px-6 py-2.5 font-semibold text-ink hover:bg-green">New observation</Link>
      </div>

      <div className="mt-6 space-y-3">
        {rows.length === 0 ? (
          <Empty>{org ? "Nothing has been shared with your organisation yet. Colleagues' drafts are never shown here." : "You haven't written anything yet. Start a private draft."}</Empty>
        ) : rows.map((c) => (
          <Link key={c.id} href={`/workspace/observations/${c.id}`} className="block">
            <Card className="transition hover:shadow-[var(--az-shadow-card)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-lg font-semibold">{c.title}</p>
                <StatusBadge status={c.status} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {KIND_LABEL[c.kind as keyof typeof KIND_LABEL] ?? c.kind} · {c.offering} · version {c.version}{c.author ? ` · ${c.author}` : ""} · updated {c.updatedAt.toISOString().slice(0, 10)}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </ClientShell>
  );
}
