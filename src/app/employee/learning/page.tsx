import { EmployeeShell } from "@/components/portal/EmployeeShell";
import { FeedView } from "@/components/learning/FeedView";
import { guardEmployee } from "@/lib/auth/pages";
import { dbAuditSink } from "@/lib/audit/log";
import { getDb } from "@/lib/db";

export const metadata = { title: "Shared learning | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function EmployeeLearningPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const g = await guardEmployee();
  if ("denied" in g) return g.denied;
  const db = getDb();
  return (
    <EmployeeShell session={g.session} active="learning" title="Shared learning" lead="The same approved, de-identified feed clients see. Employees see no more than clients do, and never a private source from here.">
      <FeedView db={db} principal={g.session.principal} audit={dbAuditSink(db)} raw={await searchParams} base="/employee/learning" />
    </EmployeeShell>
  );
}
