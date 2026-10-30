import { Card, Empty, EmployeeShell } from "@/components/portal/EmployeeShell";
import { DecisionPanel, RunForm } from "@/components/federated/Controls";
import { HonestBanner, MetricHead, MetricRow, RoundChart, num, pct } from "@/components/federated/Display";
import { guardEmployee } from "@/lib/auth/pages";
import { dbAuditSink } from "@/lib/audit/log";
import { getDb } from "@/lib/db";
import { FAULT_LABEL } from "@/lib/federated/faults";
import { employeeOverview } from "@/lib/federated/service";
import type { EvalReport } from "@/lib/federated/types";

export const metadata = { title: "Federated programme | azentio.ai" };
export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<string, string> = { candidate: "Candidate (not in use)", approved: "Approved", deployed: "Deployed (registry state)", rejected: "Rejected", rolled_back: "Rolled back", superseded: "Superseded" };

export default async function FederatedPage() {
  // Either federated grant opens the page; each action behind it checks its own grant on the server.
  const g = await guardEmployee(["federated.coordinate", "federated.approve"]);
  if ("denied" in g) return g.denied;
  const db = getDb();
  const o = await employeeOverview(db, g.session.principal, dbAuditSink(db));
  const active = o.enrolments.filter((e) => e.status === "enrolled");
  const run = o.runs[0];
  const completed = run?.rounds.filter((r) => r.status === "completed") ?? [];
  const final: EvalReport | undefined = completed.length ? (completed[completed.length - 1].holdout as EvalReport) : undefined;
  const refs = run ? [...new Set(run.rounds.flatMap((r) => r.updates.map((u) => u.participantRef)))] : [];

  return (
    <EmployeeShell session={g.session} active="federated" title={o.programme.name} lead={o.programme.description}>
      <HonestBanner />

      <section aria-labelledby="enrolled" className="mb-10">
        <h2 id="enrolled" className="mb-3 text-xl font-semibold text-ink">Participants</h2>
        <Card>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[#c9d3d9] text-left text-xs uppercase tracking-wide text-muted"><th scope="col" className="py-2">Organisation</th><th scope="col">Pseudonym in logs</th><th scope="col">Simulated data profile</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {o.enrolments.map((e) => (
                <tr key={e.ref} className="border-b border-white/60"><td className="py-2">{e.orgName}</td><td><code>{e.ref}</code></td><td>{e.profile.replaceAll("_", " ")}</td><td>{e.status}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">{active.length} enrolled · minimum cohort {o.programme.minCohort}. Clients enrol and withdraw themselves; coordinators cannot enrol anyone. Run logs use the pseudonyms only.</p>
        </Card>
      </section>

      {o.canCoordinate ? (
        <section aria-labelledby="run" className="mb-10">
          <h2 id="run" className="mb-3 text-xl font-semibold text-ink">Run the programme</h2>
          <Card><RunForm enrolled={active.length} /></Card>
        </section>
      ) : (
        <p className="mb-10 text-sm text-muted">Starting a run needs the federated.coordinate grant, which you do not hold.</p>
      )}

      <section aria-labelledby="latest" className="mb-10">
        <h2 id="latest" className="mb-3 text-xl font-semibold text-ink">Latest run</h2>
        {!run ? <Empty>No run yet.</Empty> : (
          <div className="space-y-5">
            {run.injectedFaults.length > 0 && (
              <p role="note" className="rounded-az border border-[#e0b04f] bg-[#fff8e6] p-3 text-sm">
                <strong>Injected fault (demonstration):</strong> {run.injectedFaults.map((f) => `${FAULT_LABEL[f.kind]} on ${f.ref}`).join("; ")}.
              </p>
            )}
            <p className="text-sm text-text">
              {run.config.rounds} rounds · {run.config.agg.method === "fedavg" ? `weighted average, no client above ${pct(run.config.agg.weightCap)}` : "trimmed mean"} · updates clipped to norm {run.config.agg.clipNorm}
              {run.dp ? ` · noise on, ε ≈ ${num((run.dp as { epsilon: number }).epsilon, 1)} at δ=1e-5 (see assumptions below)` : " · noise off: no privacy guarantee claimed"}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <RoundChart label="Holdout log loss (lower is better)" values={completed.map((r) => (r.holdout as EvalReport).logLoss)} higherIsBetter={false} minSpan={0.3} />
              <RoundChart label="Holdout accuracy" values={completed.map((r) => (r.holdout as EvalReport).accuracy)} higherIsBetter minSpan={0.1} format={pct} />
              <RoundChart label="Holdout calibration error" values={completed.map((r) => (r.holdout as EvalReport).ece)} higherIsBetter={false} minSpan={0.2} />
            </div>

            <Card className="overflow-x-auto">
              <h3 className="mb-2 font-semibold">Final model against baselines (holdout, synthetic)</h3>
              {final ? (
                <table className="w-full min-w-[640px] text-sm">
                  <MetricHead />
                  <tbody>
                    <MetricRow name="Untrained model" m={run.baselines.zero} />
                    {Object.entries(run.baselines.alone).map(([ref, m]) => <MetricRow key={ref} name={`${ref} trained alone`} m={m} />)}
                    <MetricRow name="Federated model" m={final} strong />
                  </tbody>
                </table>
              ) : <p className="text-sm">No round completed, so there is no federated model to compare.</p>}
              <p className="mt-3 text-xs text-muted">Each client &ldquo;alone&rdquo; was trained for the same total number of local steps and evaluated on the same holdout. Nobody&rsquo;s own data is the test set. No centralised reference was run, so the comparison says nothing about how close this is to pooling the data.</p>
            </Card>

            <Card className="overflow-x-auto">
              <h3 className="mb-2 font-semibold">What the coordinator saw, per round</h3>
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-[#c9d3d9] text-left text-xs uppercase tracking-wide text-muted"><th scope="col" className="py-2">Round</th><th scope="col">Outcome</th>{refs.map((r) => <th key={r} scope="col"><code>{r}</code></th>)}<th scope="col" className="text-right">Holdout acc.</th></tr></thead>
                <tbody>
                  {run.rounds.map((r) => (
                    <tr key={r.id} className="border-b border-white/60 align-top">
                      <td className="py-2">{r.round}</td>
                      <td>{r.status === "completed" ? "Completed" : "Abandoned: below minimum cohort"}</td>
                      {refs.map((ref) => {
                        const u = r.updates.find((x) => x.participantRef === ref);
                        return <td key={ref}>{!u ? "—" : u.status === "accepted" ? `accepted · weight ${num(u.weight, 2)}${u.rawNorm !== null && u.clippedNorm !== null && u.rawNorm > u.clippedNorm ? " · clipped" : ""}` : `${u.status}${u.reason ? ` · ${u.reason.replaceAll("_", " ")}` : ""}`}</td>;
                      })}
                      <td className="text-right">{pct((r.holdout as EvalReport).accuracy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted">Metadata only: a status, a reason code and norms. No example, label or weight vector is stored or shown. The poisoning screen reduces risk; it does not eliminate it, and a patient attacker staying inside the bounds would pass.</p>
            </Card>

            {run.dp && (
              <Card>
                <h3 className="mb-2 font-semibold">Privacy accountant (declared)</h3>
                <p className="text-sm">{(run.dp as { mechanism: string }).mechanism}. ε ≈ {num((run.dp as { epsilon: number }).epsilon, 1)} at δ = 1e-5 over {(run.dp as { rounds: number }).rounds} rounds.</p>
                <ul className="mt-2 list-disc pl-5 text-sm text-text">{(run.dp as { assumptions: string[] }).assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              </Card>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="registry" className="mb-10">
        <h2 id="registry" className="mb-3 text-xl font-semibold text-ink">Candidate model registry</h2>
        <p className="mb-4 max-w-3xl text-sm text-text">A run produces a candidate. It is never used automatically. Someone with the federated.approve grant, who did not register it, approves it, and only then can it be deployed. Rolling back restores the previous approved model if it is still fit to use.</p>
        {o.versions.length === 0 ? <Empty>No candidate models yet.</Empty> : (
          <div className="space-y-4">
            {o.versions.map((v) => {
              const m = v.metrics as { final: EvalReport; roundsCompleted: number; roundsRequested: number };
              return (
                <Card key={v.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold">{v.label}</p>
                      <p className="text-xs text-muted">{STATUS_TEXT[v.status] ?? v.status} · {m.roundsCompleted}/{m.roundsRequested} rounds · accuracy {pct(m.final.accuracy)} · log loss {num(m.final.logLoss)} · {(v.contributorRefs as string[]).length} contributors{v.registeredBy === o.userId ? " · registered by you" : ""}</p>
                    </div>
                  </div>
                  {v.needsReview && <p role="note" className="mt-3 rounded-az border border-[#e0b04f] bg-[#fff8e6] p-3 text-sm"><strong>Flagged for review.</strong> {v.needsReviewReason}</p>}
                  {v.decisions.length > 0 && <ul className="mt-3 text-xs text-muted">{v.decisions.map((d) => <li key={d.id}>{d.action.replaceAll("_", " ")} · {new Date(d.at).toISOString().slice(0, 16).replace("T", " ")} UTC{d.note ? ` · “${d.note}”` : ""}</li>)}</ul>}
                  <div className="mt-3"><DecisionPanel id={v.id} status={v.status} needsReview={v.needsReview} canApprove={o.canApprove} isRegistrar={v.registeredBy === o.userId} /></div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </EmployeeShell>
  );
}
