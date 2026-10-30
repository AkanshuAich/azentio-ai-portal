import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmployeeShell } from "@/components/portal/EmployeeShell";
import { IdeaWorkbench } from "@/components/learning/IdeaWorkbench";
import { guardEmployee } from "@/lib/auth/pages";
import { dbAuditSink } from "@/lib/audit/log";
import { getDb } from "@/lib/db";
import { NotFoundError } from "@/lib/employee/service";
import { searchFeed } from "@/lib/learning/feed";
import { getIdea } from "@/lib/learning/ideas";

export const metadata = { title: "Idea | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await guardEmployee("ideas.manage");
  if ("denied" in g) return g.denied;
  const { id } = await params;
  const db = getDb();
  const audit = dbAuditSink(db);
  let data;
  try { data = await getIdea(db, g.session.principal, audit, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const feed = await searchFeed(db, g.session.principal, audit, { limit: 100 });
  const linked = new Set(data.evidence.map((e) => e.id));

  return (
    <EmployeeShell session={g.session} active="ideas" title={data.idea.title}>
      <Link href="/employee/ideas" className="text-sm text-muted hover:text-ink">← All ideas</Link>
      <div className="mt-4 grid gap-10 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-accent-text">Problem</h2>
            <p className="mt-1 text-sm text-ink">{data.idea.problem}</p>
            {data.idea.proposedOutcome && (<><h2 className="mt-4 text-sm font-semibold uppercase tracking-wider text-accent-text">Proposed outcome</h2><p className="mt-1 text-sm text-ink">{data.idea.proposedOutcome}</p></>)}
            <p className="mt-4 text-xs text-muted">{data.idea.offering} · {data.idea.ownerTeam} · priority {data.idea.priority}</p>
            {!data.mine && <p role="note" className="mt-3 text-xs text-amber-900">This idea is assigned to someone else. You can read it, but changes are refused.</p>}
          </Card>
        </div>
        <div className="lg:col-span-2">
          <IdeaWorkbench id={data.idea.id} status={data.idea.status}
            evidence={data.evidence.map((e) => ({ id: e.id, title: e.title }))}
            available={feed.items.filter((i) => !linked.has(i.id)).map((i) => ({ id: i.id, title: i.title }))} />
        </div>
      </div>
    </EmployeeShell>
  );
}
