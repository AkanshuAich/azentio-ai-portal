import { EmployeeShell, Empty } from "@/components/portal/EmployeeShell";
import { PlaygroundClient } from "@/components/portal/PlaygroundClient";
import { guardEmployee } from "@/lib/auth/pages";
import { getDb } from "@/lib/db";
import { listMyRuns, scenarioTitles } from "@/lib/employee/service";
import { SCENARIOS } from "@/lib/playground/scenarios";

export const metadata = { title: "Playground | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function PlaygroundPage({ searchParams }: { searchParams: Promise<{ scenario?: string }> }) {
  const g = await guardEmployee();
  if ("denied" in g) return g.denied;
  const { scenario } = await searchParams;
  const runs = await listMyRuns(getDb(), g.session.principal);
  const titles = scenarioTitles();

  return (
    <EmployeeShell
      session={g.session}
      active="playground"
      title="Explore. Experiment. Evolve."
      lead="A guided space to explore product workflows. Every scenario uses fictional, synthetic data and produces simulated output."
    >
      <PlaygroundClient scenarios={SCENARIOS.map((s) => s.meta)} initialId={scenario} />

      <section className="mt-14">
        <h2 className="text-lg font-semibold text-ink">Your recent runs</h2>
        <div className="mt-3">
          {runs.length === 0 ? <Empty>You haven&apos;t run anything yet.</Empty> : (
            <ul className="divide-y divide-panel rounded-az-lg border border-panel">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-ink">
                  <span className="font-semibold">{titles.get(r.scenarioId) ?? r.scenarioId}</span>
                  <span className="text-muted">{r.createdAt.toUTCString()} · {r.feedback ? "feedback given" : "no feedback yet"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </EmployeeShell>
  );
}
