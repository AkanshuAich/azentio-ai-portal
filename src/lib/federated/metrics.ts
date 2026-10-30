import { predictProba } from "./model";
import type { EvalReport, Example, Metrics, Weights } from "./types";

/** Rank-based AUC with tie handling (Mann-Whitney U). Null when only one class is present. */
export function auc(scores: number[], labels: number[]): number | null {
  const pos = labels.filter((l) => l === 1).length;
  const neg = labels.length - pos;
  if (pos === 0 || neg === 0) return null;
  const order = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => a.s - b.s);
  let rankSumPos = 0;
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].s === order[i].s) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (order[k].y === 1) rankSumPos += avgRank;
    i = j + 1;
  }
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

const EPS = 1e-12;

export function metricsOf(probs: number[], labels: number[]): Metrics {
  const n = labels.length;
  let correct = 0, ll = 0, brier = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.min(1 - EPS, Math.max(EPS, probs[i]));
    if ((p >= 0.5 ? 1 : 0) === labels[i]) correct++;
    ll += labels[i] === 1 ? -Math.log(p) : -Math.log(1 - p);
    brier += (p - labels[i]) ** 2;
  }
  // Expected calibration error, 10 equal-width bins.
  let ece = 0;
  for (let b = 0; b < 10; b++) {
    const idx = probs.map((p, i) => i).filter((i) => probs[i] >= b / 10 && (b === 9 ? probs[i] <= 1 : probs[i] < (b + 1) / 10));
    if (idx.length === 0) continue;
    const conf = idx.reduce((s, i) => s + probs[i], 0) / idx.length;
    const acc = idx.reduce((s, i) => s + labels[i], 0) / idx.length;
    ece += (idx.length / n) * Math.abs(conf - acc);
  }
  return { n, auc: auc(probs, labels), accuracy: correct / n, logLoss: ll / n, brier: brier / n, ece };
}

/**
 * Evaluation on a holdout that nobody trains on. Slices expose who the model serves poorly: strongly seasonal
 * versus weakly seasonal quarters (by the seasonal_strength feature).
 */
export function evaluate(w: Weights, holdout: Example[]): EvalReport {
  const probs = holdout.map((e) => predictProba(w, e.x));
  const labels = holdout.map((e) => e.y);
  const slice = (pick: (e: Example) => boolean) => {
    const idx = holdout.map((e, i) => i).filter((i) => pick(holdout[i]));
    return metricsOf(idx.map((i) => probs[i]), idx.map((i) => labels[i]));
  };
  return {
    ...metricsOf(probs, labels),
    slices: {
      high_seasonality: slice((e) => e.x[2] > 0.3),
      low_seasonality: slice((e) => e.x[2] <= 0.3),
    },
  };
}
