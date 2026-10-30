import { ClientShell } from "@/components/portal/ClientShell";
import { Card, Empty } from "@/components/portal/EmployeeShell";
import { EnrolPanel } from "@/components/federated/Controls";
import { HonestBanner, num, pct } from "@/components/federated/Display";
import { guardClient } from "@/lib/auth/pages";
import { getDb } from "@/lib/db";
import { clientView } from "@/lib/federated/service";
import { unreadCount } from "@/lib/notifications/inapp";

export const metadata = { title: "Federated programme | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function FederatedWorkspacePage() {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const db = getDb();
  const v = await clientView(db, g.session.principal);
  const enrolled = v.enrolment?.status === "enrolled";

  return (
    <ClientShell session={g.session} active="federated" unread={await unreadCount(db, g.session.user.id)} title={v.programme.name}
      lead="An optional programme in which clients jointly improve a model without sending their records to anyone. Joining is your administrator's choice and can be reversed.">
      <HonestBanner />

      <section aria-labelledby="terms" className="mb-10">
        <h2 id="terms" className="mb-3 text-xl font-semibold text-ink">What joining means</h2>
        <Card>
          <ol className="list-decimal space-y-2 pl-5 text-sm">{v.consent.map((c) => <li key={c}>{c}</li>)}</ol>
        </Card>
      </section>

      <section aria-labelledby="status" className="mb-10">
        <h2 id="status" className="mb-3 text-xl font-semibold text-ink">Your organisation</h2>
        <Card>
          <p className="text-sm">
            {enrolled ? <>Enrolled. In programme logs you appear only as <code>{v.enrolment!.participantRef}</code>.</>
              : v.enrolment?.status === "withdrawn" ? "Withdrawn. You are excluded from future runs." : "Not enrolled."}
            {v.participatingOrganisations !== null ? ` ${v.participatingOrganisations} organisations are taking part.` : ` Participant counts are shown only once at least ${v.programme.minCohort} organisations are enrolled.`}
          </p>
          <div className="mt-4">
            {v.canManage ? <EnrolPanel enrolled={enrolled} /> : <p className="text-sm text-muted">Only a client administrator can enrol or withdraw your organisation.</p>}
          </div>
        </Card>
      </section>

      <section aria-labelledby="history" className="mb-10">
        <h2 id="history" className="mb-3 text-xl font-semibold text-ink">Your recent participation</h2>
        {v.history.length === 0 ? <Empty>No rounds yet. You can see only your own participation here, never another organisation&rsquo;s.</Empty> : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="border-b border-[#c9d3d9] text-left text-xs uppercase tracking-wide text-muted"><th scope="col" className="py-2">Run</th><th scope="col">Round</th><th scope="col">Outcome</th><th scope="col" className="text-right">Update size</th><th scope="col" className="text-right">Share</th></tr></thead>
              <tbody>
                {v.history.map((h, i) => (
                  <tr key={i} className="border-b border-white/60">
                    <td className="py-2">{new Date(h.runStartedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</td><td>{h.round}</td>
                    <td>{h.status}{h.reason ? ` · ${h.reason.replaceAll("_", " ")}` : ""}</td><td className="text-right">{num(h.rawNorm)}</td><td className="text-right">{h.weight === null ? "—" : pct(h.weight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section aria-labelledby="model" className="mb-10">
        <h2 id="model" className="mb-3 text-xl font-semibold text-ink">Deployed model</h2>
        {!v.deployedModel ? <Empty>No model has been approved and deployed. Candidate models are reviewed by Azentio and are not shown here.</Empty> : (
          <Card>
            <p className="font-semibold">{v.deployedModel.label}</p>
            <p className="mt-1 text-sm">Accuracy {pct(v.deployedModel.final.accuracy)} · log loss {num(v.deployedModel.final.logLoss)} · calibration error {num(v.deployedModel.final.ece)} on a synthetic holdout.</p>
            <p className="mt-2 text-xs text-muted">Synthetic evaluation only. This is a registry state, not a model serving real credit decisions.</p>
          </Card>
        )}
      </section>
    </ClientShell>
  );
}
