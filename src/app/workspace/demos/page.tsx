import Link from "next/link";
import { Card, Empty } from "@/components/portal/EmployeeShell";
import { ClientShell } from "@/components/portal/ClientShell";
import { guardClient } from "@/lib/auth/pages";
import { listSandboxes } from "@/lib/client/service";
import { getDb } from "@/lib/db";
import { unreadCount } from "@/lib/notifications/inapp";

export const metadata = { title: "Demonstrations | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function DemosPage() {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const sandboxes = listSandboxes(g.session.principal);
  const unread = await unreadCount(getDb(), g.session.user.id);

  return (
    <ClientShell session={g.session} active="demos" unread={unread} title="Demonstrations"
      lead="Guided sandboxes for the offerings enabled for your organisation. They use synthetic data and produce simulated output.">
      {sandboxes.length === 0 ? (
        <Empty>No sandboxes are enabled for your organisation yet.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {sandboxes.map((s) => (
            <Link key={s.id} href={`/workspace/demos/${s.productSlug}`} className="block">
              <Card className="h-full transition hover:shadow-[var(--az-shadow-card)]">
                <p className="font-semibold">{s.title}</p>
                <p className="mt-2 text-sm text-text">{s.blurb}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </ClientShell>
  );
}
