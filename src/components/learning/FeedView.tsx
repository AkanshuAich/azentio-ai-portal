import Link from "next/link";
import { Card, Empty } from "@/components/portal/EmployeeShell";
import { JsonAction } from "@/components/portal/JsonAction";
import { JsonForm } from "@/components/portal/JsonForm";
import { AiraPanel } from "./AiraPanel";
import { AudienceBanner } from "./badges";
import { ItemActions } from "./ItemActions";
import type { Db } from "@/lib/db/client";
import type { AuditSink } from "@/lib/authz/guard";
import type { Principal } from "@/lib/authz/types";
import { listSavedSearches, searchFeed, searchParams as searchSchema, type FacetBucket } from "@/lib/learning/feed";
import { KIND_LABEL, EVIDENCE_LABEL } from "@/lib/learning/validation";
import { getDb } from "@/lib/db";
import { publicationFeedback } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const FILTERS = ["q", "offering", "industry", "region", "period", "topic"] as const;
const select = "mt-1 w-full rounded-az border border-[#c9d3d9] bg-white px-3 py-2 text-sm text-ink";

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

function Facet({ title, name, buckets, current, base, label }: { title: string; name: string; buckets: FacetBucket[]; current: Record<string, string>; base: string; label?: (v: string) => string }) {
  if (buckets.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-accent-text">{title}</h3>
      <ul className="mt-1 space-y-0.5 text-sm">
        {buckets.map((b) => {
          const active = current[name] === b.value;
          return (
            <li key={b.value}>
              <Link href={`${base}${qs({ ...current, [name]: active ? undefined : b.value, offset: undefined })}`} className={`hover:underline ${active ? "font-semibold text-ink" : "text-text"}`}>
                {label ? label(b.value) : b.value}{" "}
                {/* A count is shown only when enough organisations stand behind it. */}
                <span className="text-xs text-muted">{b.count === null ? "" : `(${b.count})`}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The shared learning feed, rendered server-side for both clients and employees. Everything it shows
 * comes from searchFeed(), so search, counts, facets, saved searches and the export all obey one rule.
 */
export async function FeedView({
  db, principal, audit, raw, base, canExportAndSave = true,
}: { db: Db; principal: Principal; audit: AuditSink; raw: Record<string, string | undefined>; base: string; canExportAndSave?: boolean }) {
  const params = searchSchema.parse(raw);
  const res = await searchFeed(db, principal, audit, params);
  const saved = await listSavedSearches(db, principal);
  const current: Record<string, string> = {};
  for (const k of FILTERS) { const v = params[k as keyof typeof params]; if (typeof v === "string" && v) current[k] = v; }

  // Each viewer's own feedback only. Totals are never shown here.
  const ids = res.items.map((i) => i.id);
  const mine = ids.length ? await getDb().select({ id: publicationFeedback.publicationId, v: publicationFeedback.value }).from(publicationFeedback).where(and(inArray(publicationFeedback.publicationId, ids), eq(publicationFeedback.userId, principal.userId))) : [];
  const myVote = new Map(mine.map((m) => [m.id, m.v]));
  const filtered = Object.keys(current).length > 0;

  return (
    <div>
      <AudienceBanner kind="shared" />
      <AiraPanel />

      <form method="get" action={base} className="mt-10 grid gap-3 rounded-az-lg bg-panel p-5 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <div className="sm:col-span-2">
          <label htmlFor="q" className="text-xs font-semibold">Search</label>
          <input id="q" name="q" defaultValue={current.q ?? ""} maxLength={200} placeholder="e.g. seasonal cash flow" className={select} />
        </div>
        {([["offering", "Offering", res.facets.offering], ["industry", "Industry", res.facets.industry], ["region", "Region", res.facets.region], ["period", "Period", res.facets.period]] as const).map(([name, label, buckets]) => (
          <div key={name}>
            <label htmlFor={name} className="text-xs font-semibold">{label}</label>
            <select id={name} name={name} defaultValue={current[name] ?? ""} className={select}>
              <option value="">Any</option>{buckets.map((b) => <option key={b.value} value={b.value}>{b.value}</option>)}
            </select>
          </div>
        ))}
        <div>
          <label htmlFor="topic" className="text-xs font-semibold">Topic</label>
          <select id="topic" name="topic" defaultValue={current.topic ?? ""} className={select}>
            <option value="">Any</option>{res.facets.topic.map((b) => <option key={b.value} value={b.value}>{KIND_LABEL[b.value as keyof typeof KIND_LABEL] ?? b.value}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <button className="rounded-full bg-[var(--az-cta-dark)] px-6 py-2 text-sm font-semibold text-white hover:bg-card">Search</button>
          {filtered && <Link href={base} className="text-sm text-muted underline">Clear filters</Link>}
          {canExportAndSave && <a href={`/api/learning/export${qs(current)}`} className="ml-auto text-sm text-accent-text underline">Export these results (CSV)</a>}
        </div>
      </form>

      <div className="mt-8 grid gap-10 lg:grid-cols-4">
        <aside className="space-y-6 lg:col-span-1">
          <Facet title="Offering" name="offering" buckets={res.facets.offering} current={current} base={base} />
          <Facet title="Industry" name="industry" buckets={res.facets.industry} current={current} base={base} />
          <Facet title="Region" name="region" buckets={res.facets.region} current={current} base={base} />
          <Facet title="Topic" name="topic" buckets={res.facets.topic} current={current} base={base} label={(v) => KIND_LABEL[v as keyof typeof KIND_LABEL] ?? v} />
          <p className="text-xs text-muted">A number appears only when enough different organisations are behind it.</p>

          {canExportAndSave && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-accent-text">Saved searches</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {saved.length === 0 && <li className="text-muted">None yet.</li>}
                {saved.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <Link href={`${base}${qs(s.query as Record<string, string>)}`} className="text-text hover:underline">{s.name}</Link>
                    <JsonAction url={`/api/learning/saved-searches/${s.id}`} method="DELETE" label="Delete" />
                  </li>
                ))}
              </ul>
              {filtered && (
                <div className="mt-3">
                  <JsonForm url="/api/learning/saved-searches" submit="Save this search" extra={{ query: current }} fields={[{ name: "name", label: "Name this search", required: true, maxLength: 80 }]} />
                </div>
              )}
            </section>
          )}
        </aside>

        <section className="lg:col-span-3" aria-label="Results">
          <p className="text-sm text-muted">{res.total} approved observation{res.total === 1 ? "" : "s"}{filtered ? " match" : ""}</p>
          <div className="mt-3 space-y-4">
            {res.items.length === 0 ? <Empty>Nothing approved matches. Try fewer filters.</Empty> : res.items.map((i) => (
              <Card key={i.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold">{i.title}</h3>
                  {i.version > 1 && <span className="rounded-full bg-white px-3 py-1 text-xs">version {i.version}</span>}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {[KIND_LABEL[i.topic as keyof typeof KIND_LABEL] ?? i.topic, i.offering, i.industry, i.region, i.observationPeriod].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-3 whitespace-pre-line text-sm text-text">{i.body}</p>
                <p className="mt-3 text-xs text-muted">
                  Evidence: {EVIDENCE_LABEL[i.evidenceType as keyof typeof EVIDENCE_LABEL] ?? "not stated"} · contributor confidence {i.confidence ?? "not stated"}
                  {i.evidenceQuality ? ` · reviewer-assessed quality ${i.evidenceQuality}` : ""}
                  {i.contributor ? ` · shared by ${i.contributor}` : " · de-identified"}
                </p>
                <ItemActions id={i.id} myFeedback={myVote.get(i.id) ?? null} />
              </Card>
            ))}
          </div>
          <div className="mt-6 flex gap-4 text-sm">
            {params.offset > 0 && <Link className="underline" href={`${base}${qs({ ...current, offset: Math.max(0, params.offset - params.limit) })}`}>← Previous</Link>}
            {params.offset + params.limit < res.total && <Link className="underline" href={`${base}${qs({ ...current, offset: params.offset + params.limit })}`}>Next →</Link>}
          </div>
        </section>
      </div>
    </div>
  );
}
