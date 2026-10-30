import { Card, Empty, EmployeeShell } from "@/components/portal/EmployeeShell";
import { JsonAction } from "@/components/portal/JsonAction";
import { JsonForm } from "@/components/portal/JsonForm";
import { guardEmployee } from "@/lib/auth/pages";
import { getDb } from "@/lib/db";
import { listArticles } from "@/lib/employee/service";

export const metadata = { title: "Knowledge library | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const g = await guardEmployee();
  if ("denied" in g) return g.denied;
  const articles = await listArticles(getDb(), g.session.principal);
  const in180 = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10);

  return (
    <EmployeeShell session={g.session} active="knowledge" title="Internal knowledge library." lead="Guides with a named owner and a review date. Tell us if one is useful or needs work.">
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {articles.length === 0 ? <Empty>The library is empty.</Empty> : articles.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-lg font-semibold">{a.title}</p>
                {a.reviewOverdue
                  ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Review overdue</span>
                  : <span className="rounded-full bg-white px-3 py-1 text-xs">Review by {a.reviewDate}</span>}
              </div>
              <p className="mt-1 text-xs text-muted">Owner: {a.ownerName}</p>
              <p className="mt-3 whitespace-pre-line text-sm text-text">{a.body}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted">Useful?</span>
                <JsonAction url={`/api/knowledge/${a.id}/feedback`} body={{ useful: true }} label={`Yes (${a.useful})`} />
                <JsonAction url={`/api/knowledge/${a.id}/feedback`} body={{ useful: false }} label={`Needs work (${a.notUseful})`} />
              </div>
            </Card>
          ))}
        </div>
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Add a guide</h2>
          <JsonForm url="/api/knowledge" submit="Publish to library" fields={[
            { name: "title", label: "Title", required: true, maxLength: 140 },
            { name: "body", label: "Content", type: "textarea", required: true, maxLength: 8000 },
            { name: "reviewDate", label: "Next review date", type: "date", required: true, defaultValue: in180, hint: "You become the owner and are asked to review it by this date." },
          ]} />
        </Card>
      </div>
    </EmployeeShell>
  );
}
