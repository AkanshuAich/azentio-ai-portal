import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/portal/EmployeeShell";
import { ClientShell } from "@/components/portal/ClientShell";
import { ObservationActions } from "@/components/learning/ObservationActions";
import { ObservationForm } from "@/components/learning/ObservationForm";
import { StatusBadge } from "@/components/learning/badges";
import { guardClient } from "@/lib/auth/pages";
import { dbAuditSink } from "@/lib/audit/log";
import { getContribution } from "@/lib/learning/contributions";
import { NotFoundError } from "@/lib/employee/service";
import { EVIDENCE_LABEL, KIND_LABEL } from "@/lib/learning/validation";
import { getDb } from "@/lib/db";
import { unreadCount } from "@/lib/notifications/inapp";
import { listPublicProducts } from "@/lib/public/products";

export const metadata = { title: "Observation | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function ObservationPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const { id } = await params;
  const db = getDb();
  let c;
  try { c = await getContribution(db, g.session.principal, dbAuditSink(db), id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const offerings = (await listPublicProducts(db)).map((p) => ({ slug: p.slug, name: p.name }));

  return (
    <ClientShell session={g.session} active="observations" unread={await unreadCount(db, g.session.user.id)} title={c.title}>
      <Link href="/workspace/observations" className="text-sm text-muted hover:text-ink">← All observations</Link>
      <div className="mt-4 grid gap-10 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={c.status} />
            <span className="text-sm text-muted">{KIND_LABEL[c.kind as keyof typeof KIND_LABEL] ?? c.kind} · {c.offering} · version {c.version}</span>
          </div>

          {c.status === "returned" && c.timeline[0]?.note && (
            <div role="alert" className="rounded-az-lg border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900">
              <strong>A moderator has asked for a change:</strong> {c.timeline[0].note}
            </div>
          )}
          {c.sensitiveFlags.length > 0 && (
            <div role="note" className="rounded-az-lg border-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950">
              The scan flagged possible <strong>{c.sensitiveFlags.join(", ").replace(/_/g, " ")}</strong>. Please remove identifying detail. A scan isn&apos;t a privacy guarantee, so a moderator will also review it.
            </div>
          )}

          {c.canEdit ? (
            <ObservationForm mode="edit" id={c.id} published={c.status === "published"} offerings={offerings}
              initial={{ kind: c.kind, title: c.title, body: c.body, offering: c.offering, industry: c.industry ?? "", region: c.region ?? "", observationPeriod: c.observationPeriod ?? "", evidenceType: c.evidenceType ?? "", confidence: c.confidence ?? "", sharingChoice: c.sharingChoice }} />
          ) : (
            <Card>
              <p className="whitespace-pre-line text-sm text-text">{c.body}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-muted">Industry</dt><dd>{c.industry ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted">Region</dt><dd>{c.region ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted">Period</dt><dd>{c.observationPeriod ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted">Evidence</dt><dd>{EVIDENCE_LABEL[c.evidenceType as keyof typeof EVIDENCE_LABEL] ?? "—"} · confidence {c.confidence ?? "—"}</dd></div>
              </dl>
            </Card>
          )}

          {c.isAuthor && (
            <ObservationActions id={c.id} canSubmit={c.canSubmit} canWithdraw={c.canWithdraw} sharingChoice={c.sharingChoice} orgShared={c.orgShared} published={c.status === "published"} consents={c.consents} />
          )}
        </div>

        <aside className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold text-ink">Who can see what</h2>
            <ul className="mt-3 space-y-3">
              {c.visibility.map((v) => (
                <li key={v.version} className="rounded-az-lg bg-panel p-4 text-sm text-ink">
                  <p className="font-semibold">{v.version}</p>
                  <p className="mt-1"><span className="text-muted">Seen by:</span> {v.who}</p>
                  <p className="mt-1 text-text"><span className="text-muted">Used for:</span> {v.use}</p>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-ink">Status history</h2>
            <ol className="mt-3 space-y-3 border-l-2 border-panel pl-4">
              {c.timeline.map((t, i) => (
                <li key={i} className="text-sm text-ink">
                  <p className="font-semibold">{t.to.replace(/_/g, " ")}</p>
                  {t.note && <p className="text-text">{t.note}</p>}
                  <p className="text-xs text-muted">{t.at.toUTCString()}</p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </ClientShell>
  );
}
