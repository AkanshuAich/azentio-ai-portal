import Link from "next/link";
import { Card, Empty, EmployeeShell } from "@/components/portal/EmployeeShell";
import { JsonForm } from "@/components/portal/JsonForm";
import { guardEmployee } from "@/lib/auth/pages";
import { dbAuditSink } from "@/lib/audit/log";
import { getDb } from "@/lib/db";
import { IDEA_LABEL, IDEA_STATUSES, listIdeas } from "@/lib/learning/ideas";
import { listPublicProducts } from "@/lib/public/products";

export const metadata = { title: "Improvement ideas | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  // Needs the ideas.manage grant, separate from being an employee and from moderation.
  const g = await guardEmployee("ideas.manage");
  if ("denied" in g) return g.denied;
  const db = getDb();
  const ideas = await listIdeas(db, g.session.principal, dbAuditSink(db));
  const offerings = (await listPublicProducts(db)).map((p) => ({ slug: p.slug, name: p.name }));

  return (
    <EmployeeShell session={g.session} active="ideas" title="Improvement ideas" lead="Turn recurring themes into improvement ideas. An idea is a proposal, not a promised delivery.">
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {ideas.length === 0 ? <Empty>No ideas yet.</Empty> : ideas.map((i) => (
            <Link key={i.id} href={`/employee/ideas/${i.id}`} className="block">
              <Card className="transition hover:shadow-[var(--az-shadow-card)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-lg font-semibold">{i.title}</p>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold">{IDEA_LABEL[i.status as (typeof IDEA_STATUSES)[number]] ?? i.status}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{i.offering} · {i.ownerTeam} · owner {i.ownerName ?? "unassigned"}{i.mine ? " (you)" : ""} · {i.clientVisible ? "client update published" : "not visible to clients"}</p>
              </Card>
            </Link>
          ))}
        </div>
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Create an idea</h2>
          <JsonForm url="/api/ideas" submit="Create idea" fields={[
            { name: "title", label: "Title", required: true, maxLength: 140 },
            { name: "problem", label: "Problem statement", type: "textarea", required: true, maxLength: 2000 },
            { name: "offering", label: "Offering", type: "select", defaultValue: offerings[0]?.slug, options: offerings.map((o) => ({ value: o.slug, label: o.name })) },
            { name: "proposedOutcome", label: "Proposed outcome (optional)", type: "textarea", maxLength: 1000 },
            { name: "ownerTeam", label: "Owner / team", required: true, maxLength: 100 },
            { name: "priority", label: "Priority", type: "select", defaultValue: "medium", options: [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }] },
          ]} />
          <p className="mt-3 text-xs text-muted">Link supporting evidence on the next screen. It starts as Proposed and hidden from clients.</p>
        </Card>
      </div>
    </EmployeeShell>
  );
}
