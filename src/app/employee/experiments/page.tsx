import { Card, Empty, EmployeeShell } from "@/components/portal/EmployeeShell";
import { JsonForm } from "@/components/portal/JsonForm";
import { StatusSelect } from "@/components/portal/JsonAction";
import { guardEmployee } from "@/lib/auth/pages";
import { getDb } from "@/lib/db";
import { EXPERIMENT_STATUSES, listExperiments } from "@/lib/employee/service";

export const metadata = { title: "Experiments | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  const g = await guardEmployee();
  if ("denied" in g) return g.denied;
  const rows = await listExperiments(getDb(), g.session.principal);

  return (
    <EmployeeShell session={g.session} active="experiments" title="Experiment boldly." lead="Internal experiments. Visible to employees only, never on the public site, in client search or in AIRA.">
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {rows.length === 0 ? <Empty>No experiments yet. Submit the first one.</Empty> : rows.map((e) => (
            <Card key={e.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{e.title}</p>
                  <p className="text-xs text-muted">{e.ownerName} · updated {e.updatedAt.toUTCString()}</p>
                </div>
                {e.ownerId === g.session.user.id ? (
                  <StatusSelect url={`/api/experiments/${e.id}`} value={e.status} options={[...EXPERIMENT_STATUSES]} />
                ) : <span className="rounded-full bg-white px-3 py-1 text-sm">{e.status}</span>}
              </div>
              <p className="mt-3 text-sm text-text"><strong>Hypothesis.</strong> {e.hypothesis}</p>
              {e.expectedOutcome && <p className="mt-1 text-sm text-text"><strong>Expected outcome.</strong> {e.expectedOutcome}</p>}
            </Card>
          ))}
        </div>
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Submit an experiment</h2>
          <JsonForm url="/api/experiments" submit="Submit experiment" fields={[
            { name: "title", label: "Title", required: true, maxLength: 120 },
            { name: "hypothesis", label: "Hypothesis", type: "textarea", required: true, maxLength: 1000 },
            { name: "expectedOutcome", label: "Expected outcome (optional)", type: "textarea", maxLength: 600 },
          ]} />
        </Card>
      </div>
    </EmployeeShell>
  );
}
