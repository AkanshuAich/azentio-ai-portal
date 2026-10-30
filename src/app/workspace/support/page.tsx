import { Card, Empty } from "@/components/portal/EmployeeShell";
import { ClientShell } from "@/components/portal/ClientShell";
import { JsonForm } from "@/components/portal/JsonForm";
import { guardClient } from "@/lib/auth/pages";
import { listSupportRequests } from "@/lib/client/collab";
import { getDb } from "@/lib/db";
import { unreadCount } from "@/lib/notifications/inapp";

export const metadata = { title: "Support | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const db = getDb();
  const requests = await listSupportRequests(db, g.session.principal);
  const unread = await unreadCount(db, g.session.user.id);

  return (
    <ClientShell session={g.session} active="support" unread={unread} title="Support"
      lead="Raise a question about this portal. For product support on your Azentio systems, use the Azentio service desk.">
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <p className="font-semibold">Azentio service desk</p>
            <p className="mt-1 text-sm text-text">Product support tickets for your live Azentio systems are handled in the service desk, which has its own sign-in.</p>
            <a href="https://one.az.azentio.com/servicedesk/customer/user/login?destination=portals" target="_blank" rel="noreferrer noopener"
              className="mt-3 inline-block rounded-full bg-[var(--az-cta-dark)] px-5 py-2 text-sm font-semibold text-white hover:bg-card">Open the service desk →</a>
          </Card>
          <h2 className="pt-4 text-lg font-semibold text-ink">Your organisation&apos;s requests</h2>
          {requests.length === 0 ? <Empty>No requests yet.</Empty> : requests.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{r.subject}</p>
                <span className="rounded-full bg-white px-3 py-1 text-xs capitalize">{r.status}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{r.author} · {r.createdAt.toUTCString()}</p>
            </Card>
          ))}
        </div>
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Ask a question</h2>
          <p className="mb-4 text-sm text-text">Recorded for your Azentio contact. This is not yet connected to the service desk, so it is not a ticket there.</p>
          <JsonForm url="/api/client/support" submit="Send request" fields={[
            { name: "subject", label: "Subject", required: true, maxLength: 140 },
            { name: "body", label: "Details", type: "textarea", required: true, maxLength: 4000, hint: "Please don't include customer names, account numbers or credentials." },
          ]} />
        </Card>
      </div>
    </ClientShell>
  );
}
