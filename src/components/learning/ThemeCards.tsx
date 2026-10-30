import { Card, Empty } from "@/components/portal/EmployeeShell";
import { AudienceBanner } from "./badges";
import type { ThemeView } from "@/lib/learning/themes";

/** The theme dashboard. A theme with too few organisations shows its title and why its numbers are withheld, nothing more. */
export function ThemeCards({ themes }: { themes: ThemeView[] }) {
  return (
    <div>
      <AudienceBanner kind="shared" />
      <div className="space-y-5">
        {themes.length === 0 && <Empty>No themes have been curated yet.</Empty>}
        {themes.map((t) => (
          <Card key={t.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-xl font-semibold">{t.title}</h2>
              <span className="rounded-full bg-white px-3 py-1 text-xs">{t.offering}</span>
            </div>
            <p className="mt-2 text-sm text-text">{t.summary}</p>

            {t.suppressed ? (
              <p role="note" className="mt-4 rounded-az border border-dashed border-[#c9d3d9] p-3 text-sm text-text">
                <strong>Not enough evidence to show figures.</strong> {t.reason}
              </p>
            ) : (
              <>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-muted">Contributing organisations</dt><dd className="text-2xl font-semibold tabular-nums">{t.distinctOrganisations}</dd></div>
                  <div><dt className="text-xs text-muted">Observation period</dt><dd>{t.observationPeriod ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted">Lowest contributor confidence</dt><dd className="capitalize">{t.confidence}</dd></div>
                  <div><dt className="text-xs text-muted">Latest update</dt><dd>{t.latestUpdate.slice(0, 10)}</dd></div>
                </dl>
                <ul className="mt-4 space-y-1 rounded-az bg-white p-3 text-sm text-ink" aria-label="Limitations">
                  {t.limitations.map((l) => <li key={l}>⚠ {l}</li>)}
                </ul>
                <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-accent-text">Supporting approved observations</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {t.evidence.map((e) => <li key={e.id} className="rounded-az bg-white p-3"><strong>{e.title}</strong><span className="block text-xs text-muted">{[e.industry, e.region, e.observationPeriod].filter(Boolean).join(" · ")}</span></li>)}
                </ul>
              </>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
