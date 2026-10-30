import type { EvalReport } from "@/lib/federated/types";

export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
export const num = (v: number | null | undefined, d = 3) => (v === null || v === undefined ? "n/a" : v.toFixed(d));

/** The two labels that must stay visible on every federated screen: what this is, and what it is not. */
export function HonestBanner() {
  return (
    <div role="note" className="mb-8 rounded-az-lg border border-[#e0b04f] bg-[#fff8e6] p-4 text-sm text-ink">
      <p className="font-semibold">SYNTHETIC DATA · SIMULATED PROGRAMME</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-text">
        <li>All participants are simulated in-process on generated data. Nothing here uses real client records or is an approved credit model.</li>
        <li>Secure aggregation: <strong>not implemented</strong>. The coordinator sees each individual update; plain averaging gives no privacy by itself.</li>
        <li>No formal privacy guarantee is claimed unless noise is switched on for a run and its accountant is shown, and then only under the stated assumptions.</li>
        <li>&ldquo;Deployed&rdquo; here is a registry state. Nothing in this portal serves predictions from a federated model.</li>
      </ul>
    </div>
  );
}

/** A small accessible line chart of one metric across rounds. */
// minSpan stops the axis zooming in on noise: a 0.8-point wobble in accuracy must not look like a collapse.
export function RoundChart({ values, label, higherIsBetter, minSpan, format = (v: number) => v.toFixed(3) }: { values: number[]; label: string; higherIsBetter: boolean; minSpan: number; format?: (v: number) => string }) {
  if (values.length === 0) return null;
  const w = 220, h = 64, pad = 6;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = Math.max(hi - lo, minSpan);
  const min = (lo + hi) / 2 - span / 2;
  const pts = values.map((v, i) => `${pad + (values.length === 1 ? 0 : (i * (w - 2 * pad)) / (values.length - 1))},${h - pad - ((v - min) / span) * (h - 2 * pad)}`).join(" ");
  const first = values[0], last = values[values.length - 1];
  const improved = higherIsBetter ? last > first : last < first;
  return (
    <figure className="rounded-az bg-white p-3">
      <figcaption className="text-xs font-semibold text-ink">{label}</figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}: from ${format(first)} to ${format(last)} over ${values.length} rounds`} className="mt-1 w-full">
        <polyline points={pts} fill="none" stroke={improved ? "var(--az-green, #22e0a0)" : "#8aa0ab"} strokeWidth="2" />
      </svg>
      <p className="text-xs text-muted">{format(first)} → {format(last)}</p>
    </figure>
  );
}

export function MetricRow({ name, m, strong = false }: { name: string; m: EvalReport; strong?: boolean }) {
  return (
    <tr className={strong ? "font-semibold" : ""}>
      <th scope="row" className="py-2 pr-4 text-left font-normal">{name}</th>
      <td className="px-2 text-right">{pct(m.accuracy)}</td>
      <td className="px-2 text-right">{num(m.auc)}</td>
      <td className="px-2 text-right">{num(m.logLoss)}</td>
      <td className="px-2 text-right">{num(m.ece)}</td>
      <td className="px-2 text-right">{pct(m.slices.high_seasonality.accuracy)}</td>
      <td className="pl-2 text-right">{pct(m.slices.low_seasonality.accuracy)}</td>
    </tr>
  );
}

export function MetricHead() {
  return (
    <thead>
      <tr className="border-b border-[#c9d3d9] text-xs uppercase tracking-wide text-muted">
        <th scope="col" className="py-2 pr-4 text-left font-semibold">Model</th>
        <th scope="col" className="px-2 text-right font-semibold">Accuracy</th>
        <th scope="col" className="px-2 text-right font-semibold">AUC</th>
        <th scope="col" className="px-2 text-right font-semibold">Log loss</th>
        <th scope="col" className="px-2 text-right font-semibold">Calibration err.</th>
        <th scope="col" className="px-2 text-right font-semibold">Acc. high-season</th>
        <th scope="col" className="pl-2 text-right font-semibold">Acc. low-season</th>
      </tr>
    </thead>
  );
}
