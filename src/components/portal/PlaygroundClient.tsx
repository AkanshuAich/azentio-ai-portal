"use client";

import { useState } from "react";
import type { FieldMeta, ScenarioMeta, ScenarioOutput } from "@/lib/playground/scenarios";

const box = "rounded-az-lg bg-panel p-5 text-ink";

export function PlaygroundClient({ scenarios, initialId }: { scenarios: ScenarioMeta[]; initialId?: string }) {
  const [scenario, setScenario] = useState<ScenarioMeta | null>(scenarios.find((s) => s.id === initialId) ?? null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; output: ScenarioOutput } | null>(null);
  const [fb, setFb] = useState({ helpful: true, accuracy: 4, comment: "" });
  const [fbState, setFbState] = useState<"idle" | "saved" | "error">("idle");

  function choose(s: ScenarioMeta) {
    setScenario(s);
    setValues(Object.fromEntries(s.fields.map((f) => [f.name, f.default])));
    setResult(null);
    setFbState("idle");
    setError(null);
  }

  const current = (f: FieldMeta) => values[f.name] ?? f.default;

  async function run() {
    if (!scenario) return;
    setBusy(true);
    setError(null);
    setFbState("idle");
    const params = Object.fromEntries(scenario.fields.map((f) => [f.name, current(f)]));
    const res = await fetch("/api/playground/run", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId: scenario.id, params }),
    });
    setBusy(false);
    if (!res.ok) return setError("That run was refused. Check the values are within range.");
    setResult(await res.json());
  }

  async function sendFeedback() {
    if (!result) return;
    const res = await fetch(`/api/playground/runs/${result.id}/feedback`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ helpful: fb.helpful, accuracy: fb.accuracy, comment: fb.comment || undefined }),
    });
    setFbState(res.ok ? "saved" : "error");
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="pg-1">
        <h2 id="pg-1" className="text-lg font-semibold text-ink"><span className="text-accent-text">1.</span> Choose an offering</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {scenarios.map((s) => (
            <button key={s.id} onClick={() => choose(s)} aria-pressed={scenario?.id === s.id}
              className={`rounded-az-lg border-2 p-5 text-left transition ${scenario?.id === s.id ? "border-green bg-white shadow-[var(--az-shadow-card)]" : "border-transparent bg-panel hover:border-green/50"}`}>
              <p className="font-semibold text-ink">{s.title}</p>
              <p className="mt-2 text-sm text-text">{s.blurb}</p>
            </button>
          ))}
        </div>
      </section>

      {scenario && (
        <section aria-labelledby="pg-2">
          <h2 id="pg-2" className="text-lg font-semibold text-ink"><span className="text-accent-text">2.</span> Inspect the inputs</h2>
          <p className="mt-1 text-sm text-text">{scenario.inputsNote}</p>
          <div className={`${box} mt-4 grid gap-5 md:grid-cols-2`}>
            {scenario.fields.map((f) => (
              <div key={f.name}>
                <label htmlFor={f.name} className="text-sm font-semibold">{f.label}</label>
                <div className="mt-1 flex items-center gap-3">
                  <input id={f.name} type="range" min={f.min} max={f.max} step={f.step} value={current(f)}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: Number(e.target.value) }))} className="w-full accent-[#0a6e52]" />
                  <output className="w-28 text-right text-sm tabular-nums">{current(f).toLocaleString("en-US")}</output>
                </div>
                <p className="mt-1 text-xs text-muted">{f.help}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button onClick={run} disabled={busy} className="rounded-full bg-[var(--az-cta-dark)] px-6 py-2.5 font-semibold text-white transition hover:bg-card disabled:opacity-50">
              {busy ? "Running…" : "Run demonstration"}
            </button>
            <span className="text-xs text-muted">Deterministic. No model is called and no real data is used.</span>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        </section>
      )}

      {result && scenario && (
        <section aria-labelledby="pg-3" className="space-y-6">
          <h2 id="pg-3" className="text-lg font-semibold text-ink"><span className="text-accent-text">3.</span> Review the evidence</h2>

          <div role="note" className="flex flex-wrap items-center gap-3 rounded-az-lg border-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950">
            <strong className="rounded-full bg-amber-500 px-3 py-1 text-xs tracking-wider text-white">{result.output.label}</strong>
            <span>{result.output.disclaimer}</span>
          </div>

          <p className="text-xl font-semibold text-ink">{result.output.headline}</p>

          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {result.output.metrics.map((m) => (
              <div key={m.label} className={box}>
                <dt className="text-xs font-semibold uppercase tracking-wider text-accent-text">{m.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{m.value}</dd>
                {m.note && <p className="mt-1 text-xs text-muted">{m.note}</p>}
              </div>
            ))}
          </dl>

          <div className={box}>
            <h3 className="font-semibold">How this was produced</h3>
            <p className="mt-1 text-sm text-text">{result.output.evidence.method}</p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-text">
              {result.output.evidence.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
            {result.output.evidence.table && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr>{result.output.evidence.table.columns.map((c) => <th key={c} className="border-b border-[#c9d3d9] py-2 pr-4 font-semibold">{c}</th>)}</tr></thead>
                  <tbody>
                    {result.output.evidence.table.rows.map((r, i) => (
                      <tr key={i}>{r.map((cell, j) => <td key={j} className="border-b border-white py-1.5 pr-4 tabular-nums">{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <section aria-labelledby="pg-4" className={box}>
            <h2 id="pg-4" className="text-lg font-semibold"><span className="text-accent-text">4.</span> Give feedback</h2>
            <div className="mt-3 flex flex-wrap items-end gap-5">
              <fieldset>
                <legend className="text-sm font-semibold">Was this useful?</legend>
                <div className="mt-1 flex gap-4 text-sm">
                  {[true, false].map((v) => (
                    <label key={String(v)} className="flex items-center gap-1.5">
                      <input type="radio" name="helpful" checked={fb.helpful === v} onChange={() => setFb({ ...fb, helpful: v })} className="accent-[#0a6e52]" />
                      {v ? "Yes" : "No"}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor="acc" className="text-sm font-semibold">Evidence clarity (1-5)</label>
                <select id="acc" value={fb.accuracy} onChange={(e) => setFb({ ...fb, accuracy: Number(e.target.value) })} className="mt-1 block rounded-az border border-[#c9d3d9] bg-white px-3 py-2">
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="min-w-[220px] flex-1">
                <label htmlFor="cm" className="text-sm font-semibold">Comment (optional)</label>
                <input id="cm" maxLength={500} value={fb.comment} onChange={(e) => setFb({ ...fb, comment: e.target.value })} className="mt-1 w-full rounded-az border border-[#c9d3d9] bg-white px-3 py-2" />
              </div>
              <button onClick={sendFeedback} className="rounded-full bg-[var(--az-cta-dark)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-card">Send feedback</button>
            </div>
            {fbState === "saved" && <p role="status" className="mt-3 text-sm text-accent-text">Thanks, feedback saved.</p>}
            {fbState === "error" && <p role="alert" className="mt-3 text-sm text-red-700">Couldn&apos;t save feedback.</p>}
          </section>
        </section>
      )}
    </div>
  );
}
