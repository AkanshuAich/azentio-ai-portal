import Link from "next/link";
import { Card, Empty } from "@/components/portal/EmployeeShell";
import { ClientShell } from "@/components/portal/ClientShell";
import { guardClient } from "@/lib/auth/pages";
import { getClientDashboard } from "@/lib/client/service";
import { getDb } from "@/lib/db";
import { dbAuditSink } from "@/lib/audit/log";
import { unreadCount } from "@/lib/notifications/inapp";

export const metadata = { title: "Client workspace | azentio.ai" };
export const dynamic = "force-dynamic";

const STATUS_ORDER = ["draft", "submitted", "in_review", "returned", "approved", "published", "withdrawn", "rejected"];
const STATUS_TEXT: Record<string, string> = {
  draft: "Drafts", submitted: "Submitted", in_review: "In review", returned: "Returned to you", approved: "Approved",
  published: "Shared", unpublished_under_review: "Paused for review", withdrawn: "Withdrawn", rejected: "Not accepted",
};

export default async function WorkspaceDashboard() {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const db = getDb();
  const d = await getClientDashboard(db, g.session.principal, dbAuditSink(db));
  const unread = await unreadCount(db, g.session.user.id);
  const statuses = Object.entries(d.contributions).sort((a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0]));

  return (
    <ClientShell session={g.session} active="dashboard" unread={unread} title={d.org.name}
      lead="Your organisation's workspace. You only see what has been enabled for you, and your own organisation's contributions.">
      <section>
        <h2 className="text-lg font-semibold text-ink">Entitled offerings</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {d.offerings.length === 0 ? (
            <div className="sm:col-span-2 lg:col-span-3"><Empty>No offerings have been enabled for your organisation yet. Your Azentio contact can enable them.</Empty></div>
          ) : d.offerings.map((o) => (
            <Card key={o.slug}>
              <p className="font-semibold">{o.name}</p>
              <p className="mt-1 text-sm text-text">{o.summary}</p>
              {o.hasSandbox && <Link href={`/workspace/demos/${o.slug}`} className="mt-3 inline-block text-sm font-semibold text-accent-text underline">Open sandbox →</Link>}
            </Card>
          ))}
        </div>
      </section>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold text-ink">Approved demonstrations and content</h2>
          <div className="mt-3 space-y-3">
            {d.demos.length === 0 ? <Empty>Nothing has been shared with your organisation yet.</Empty> : d.demos.map((m) => (
              <Card key={m.id}><p className="font-semibold">{m.title}</p><p className="text-xs text-muted">{m.kind}</p></Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">Sessions for you</h2>
          <div className="mt-3 space-y-3">
            {d.sessions.length === 0 ? <Empty>No sessions are scheduled for your organisation.</Empty> : d.sessions.map((s) => (
              <Card key={s.id}>
                <p className="font-semibold">{s.title}</p>
                <p className="text-sm text-text">{s.startsAt ? s.startsAt.toUTCString() : "Time to be announced"}</p>
                {s.streamRef && <a href={s.streamRef} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-sm font-semibold text-accent-text underline">Join →</a>}
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">Your contributions</h2>
          <div className="mt-3">
            {statuses.length === 0 ? <Empty>You haven&apos;t contributed anything yet.</Empty> : (
              <ul className="flex flex-wrap gap-2">
                {statuses.map(([k, n]) => <li key={k} className="rounded-full bg-panel px-4 py-1.5 text-sm text-ink">{STATUS_TEXT[k] ?? k}: <strong>{n}</strong></li>)}
              </ul>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">Shows your own items and anything your organisation has chosen to share. Colleagues&apos; private drafts are never counted.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">Improvement ideas</h2>
          <div className="mt-3 space-y-3">
            {d.ideas.length === 0 ? <Empty>No improvement ideas are relevant to you right now.</Empty> : d.ideas.map((i) => (
              <Card key={i.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{i.title}</p>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold">{i.statusLabel}</span>
                </div>
                <p className="mt-1 text-sm text-text">{i.summary}</p>
                <p className="mt-2 text-xs text-muted">{i.ownerTeam} · updated {i.updatedAt.toISOString().slice(0, 10)}{i.commitmentNote ? ` · ${i.commitmentNote}` : ""}</p>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </ClientShell>
  );
}
