import Link from "next/link";
import { Card, Empty, EmployeeShell } from "@/components/portal/EmployeeShell";
import { StatusBadge } from "@/components/learning/badges";
import { JsonAction } from "@/components/portal/JsonAction";
import { guardEmployee } from "@/lib/auth/pages";
import { dbAuditSink } from "@/lib/audit/log";
import { getDb } from "@/lib/db";
import { listOpenReports, listQueue } from "@/lib/learning/moderation";

export const metadata = { title: "Moderation | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function ModerationPage() {
  // Needs the learning.moderate grant, which is separate from being an employee.
  const g = await guardEmployee("learning.moderate");
  if ("denied" in g) return g.denied;
  const db = getDb();
  const audit = dbAuditSink(db);
  const queue = await listQueue(db, g.session.principal, audit);
  const reports = await listOpenReports(db, g.session.principal, audit);

  return (
    <EmployeeShell session={g.session} active="moderation" title="Review queue" lead="Only contributions their authors submitted for review appear here. Drafts and organisation-only items are out of reach, and opening a source is audited.">
      <section>
        <h2 className="text-lg font-semibold text-ink">Awaiting review</h2>
        <div className="mt-3 space-y-3">
          {queue.length === 0 ? <Empty>The queue is empty.</Empty> : queue.map((q) => (
            <Link key={q.id} href={`/employee/moderation/${q.id}`} className="block">
              <Card className="transition hover:shadow-[var(--az-shadow-card)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="font-semibold">{q.title}</p>
                  <StatusBadge status={q.status} />
                </div>
                <p className="mt-1 text-xs text-muted">{q.offering} · version {q.version} · {q.org}{q.flags.length ? ` · scan flagged: ${q.flags.join(", ").replace(/_/g, " ")}` : ""}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-ink">Reported items</h2>
        <p className="text-sm text-muted">Reports never show who made them.</p>
        <div className="mt-3 space-y-3">
          {reports.length === 0 ? <Empty>No open reports.</Empty> : reports.map((r) => (
            <Card key={r.reportId}>
              <p className="font-semibold">{r.title}</p>
              <p className="mt-1 text-sm text-text">Reported: &ldquo;{r.reason}&rdquo;</p>
              <p className="mt-1 text-xs text-muted">Reported {r.reportedAt.toUTCString()} · item is {r.status.replace(/_/g, " ")}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Link href={`/employee/moderation/${r.contributionId}`} className="rounded-full bg-[var(--az-cta-dark)] px-5 py-2 text-sm font-semibold text-white hover:bg-card">Review and decide</Link>
                <JsonAction url={`/api/moderation/reports/${r.reportId}/dismiss`} body={{ reason: "Reviewed: no action needed." }} label="Dismiss" />
              </div>
            </Card>
          ))}
        </div>
      </section>
    </EmployeeShell>
  );
}
