import Link from "next/link";
import { notFound } from "next/navigation";
import { EmployeeShell } from "@/components/portal/EmployeeShell";
import { ReviewWorkbench, type ReviewData } from "@/components/learning/ReviewWorkbench";
import { guardEmployee } from "@/lib/auth/pages";
import { dbAuditSink } from "@/lib/audit/log";
import { getDb } from "@/lib/db";
import { NotFoundError } from "@/lib/employee/service";
import { openReview } from "@/lib/learning/moderation";

export const metadata = { title: "Review | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await guardEmployee("learning.moderate");
  if ("denied" in g) return g.denied;
  const { id } = await params;
  const db = getDb();
  let data;
  // Opening the private source is audited inside openReview.
  try { data = await openReview(db, g.session.principal, dbAuditSink(db), id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }

  return (
    <EmployeeShell session={g.session} active="moderation" title={data.source.title}>
      <Link href="/employee/moderation" className="text-sm text-muted hover:text-ink">← Review queue</Link>
      <div className="mt-4"><ReviewWorkbench r={JSON.parse(JSON.stringify(data)) as ReviewData} /></div>
    </EmployeeShell>
  );
}
