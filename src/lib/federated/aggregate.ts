import { gauss, type Rng } from "./prng";
import { cosine, norm, scale } from "./model";
import type { ClientUpdate } from "./types";

/**
 * Coordinator-side handling of client updates: validation, clipping, poisoning screen, aggregation.
 * This module never sees a training example. It handles numbers a client chose to send, and nothing else.
 */
export type RejectReason =
  | "not_enrolled" | "duplicate" | "schema_version_mismatch" | "model_version_mismatch" | "shape_mismatch"
  | "non_finite" | "invalid_example_count" | "norm_exceeds_hard_limit" | "poisoning_suspected";

export interface AggConfig {
  /** L2 bound applied to every accepted update. */
  clipNorm: number;
  /** Maximum share of the aggregate any one client may hold (water-filled), so a huge client can't dominate. */
  weightCap: number;
  method: "fedavg" | "trimmed_mean";
  /** Fraction trimmed from each tail per coordinate (trimmed_mean only). */
  trimFraction: number;
  /** Minimum number of valid updates for a round to proceed. */
  minCohort: number;
  /** Reject an update whose cosine similarity to the cohort's coordinate-wise median is below this. */
  cosineMin: number;
  /** Reject an update whose raw (pre-clip) norm exceeds this multiple of the cohort's median raw norm. */
  normMultiple: number;
  /** An opposed-direction update is rejected only if its raw norm also exceeds this multiple of the median. */
  opposedNormRatio: number;
  /** Updates larger than this multiple of clipNorm are rejected outright rather than merely clipped. */
  hardNormMultiple: number;
  /** Optional Gaussian noise on the aggregate (fedavg only). Off by default: no formal privacy guarantee. */
  dp?: { noiseMultiplier: number } | null;
}

export const DEFAULT_AGG: AggConfig = {
  clipNorm: 1.5, weightCap: 0.5, method: "fedavg", trimFraction: 0.34, minCohort: 3,
  cosineMin: -0.1, normMultiple: 4, opposedNormRatio: 1.6, hardNormMultiple: 25, dp: null,
};

export interface ValidationContext {
  schemaVersion: string;
  modelVersion: string;
  dim: number;
  enrolled: Set<string>;
  seen: Set<string>;
  clipNorm: number;
  hardNormMultiple: number;
}

/** Static checks on one update. Returns the reason code to log, or null if it is acceptable so far. */
export function validateUpdate(ref: string, u: ClientUpdate, ctx: ValidationContext): RejectReason | null {
  if (!ctx.enrolled.has(ref)) return "not_enrolled";
  if (ctx.seen.has(ref)) return "duplicate";
  if (u.schemaVersion !== ctx.schemaVersion) return "schema_version_mismatch";
  if (u.modelVersion !== ctx.modelVersion) return "model_version_mismatch";
  if (!Array.isArray(u.delta) || u.delta.length !== ctx.dim) return "shape_mismatch";
  if (u.delta.some((v) => typeof v !== "number" || !Number.isFinite(v))) return "non_finite";
  if (!Number.isInteger(u.nExamples) || u.nExamples < 1) return "invalid_example_count";
  if (norm(u.delta) > ctx.clipNorm * ctx.hardNormMultiple) return "norm_exceeds_hard_limit";
  return null;
}

export function clipDelta(delta: number[], clipNorm: number) {
  const rawNorm = norm(delta);
  const k = rawNorm > clipNorm ? clipNorm / rawNorm : 1;
  return { delta: k === 1 ? delta : scale(delta, k), rawNorm, clippedNorm: Math.min(rawNorm, clipNorm), clipped: k < 1 };
}

function medianOf(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Poisoning screen against the cohort. With fewer than three updates there is no meaningful "median of the
 * others", so nothing is screened (the minimum cohort is at least three for that reason).
 *  - A raw norm far above the cohort median is suspect (scaling attacks; checked BEFORE clipping hides the size).
 *  - A direction opposed to the cohort median is suspect only when the update is also larger than typical:
 *    honest clients on skewed data legitimately pull in opposite directions near convergence, and an
 *    opposed-direction rule alone rejected them in testing (rounds stalled), so it is not used by itself.
 * This reduces risk, it does not eliminate it: a same-size reversed update, or a patient attacker staying inside
 * the bounds, passes. Clipping and the weight cap bound what such an update can do; trimmed mean bounds it further.
 */
export function screenPoisoning(
  items: { ref: string; delta: number[]; rawNorm: number }[],
  cfg: Pick<AggConfig, "cosineMin" | "normMultiple" | "opposedNormRatio">,
): Set<string> {
  const suspects = new Set<string>();
  if (items.length < 3) return suspects;
  const dim = items[0].delta.length;
  const med = Array.from({ length: dim }, (_, j) => medianOf(items.map((i) => i.delta[j])));
  const medNorm = medianOf(items.map((i) => i.rawNorm));
  for (const it of items) {
    if (medNorm > 0 && it.rawNorm > cfg.normMultiple * medNorm) suspects.add(it.ref);
    else if (medNorm > 0 && cosine(it.delta, med) < cfg.cosineMin && it.rawNorm > cfg.opposedNormRatio * medNorm) suspects.add(it.ref);
  }
  return suspects;
}

/** Shares proportional to example counts, but no share above `cap` (water-filling). Cap is floored at 1/k. */
export function cappedWeights(counts: number[], cap: number): number[] {
  const k = counts.length;
  const c = Math.max(cap, 1 / k);
  const total = counts.reduce((a, b) => a + b, 0);
  let w = counts.map((n) => n / total);
  const capped = new Array<boolean>(k).fill(false);
  for (let iter = 0; iter < k + 1; iter++) {
    const over = w.map((x, i) => x > c + 1e-12 && !capped[i]);
    if (!over.some(Boolean)) break;
    over.forEach((o, i) => { if (o) capped[i] = true; });
    const fixed = capped.reduce((s, isCapped) => s + (isCapped ? c : 0), 0);
    const freeTotal = counts.reduce((s, n, i) => s + (capped[i] ? 0 : n), 0);
    w = counts.map((n, i) => (capped[i] ? c : ((1 - fixed) * n) / freeTotal));
  }
  return w;
}

export interface Aggregated {
  delta: number[];
  weights: Record<string, number>;
  /** Standard deviation of the noise added to each coordinate, or null when no noise was added. */
  noiseStd: number | null;
  method: AggConfig["method"];
}

export function aggregate(items: { ref: string; delta: number[]; n: number }[], cfg: AggConfig, noiseRng?: Rng): Aggregated {
  const k = items.length;
  const dim = items[0].delta.length;
  let delta: number[];
  const weights: Record<string, number> = {};

  if (cfg.method === "trimmed_mean") {
    const t = Math.min(Math.floor(cfg.trimFraction * k), Math.floor((k - 1) / 2));
    delta = Array.from({ length: dim }, (_, j) => {
      const col = items.map((i) => i.delta[j]).sort((a, b) => a - b).slice(t, k - t);
      return col.reduce((a, b) => a + b, 0) / col.length;
    });
    for (const it of items) weights[it.ref] = 1 / k;
  } else {
    const w = cappedWeights(items.map((i) => i.n), cfg.weightCap);
    delta = new Array(dim).fill(0);
    items.forEach((it, idx) => {
      weights[it.ref] = w[idx];
      for (let j = 0; j < dim; j++) delta[j] += w[idx] * it.delta[j];
    });
  }

  let noiseStd: number | null = null;
  if (cfg.dp && cfg.method === "fedavg") {
    // Sensitivity of the weighted sum to one client's update: clipNorm times the largest weight.
    const maxW = Math.max(...Object.values(weights));
    noiseStd = cfg.dp.noiseMultiplier * cfg.clipNorm * maxW;
    const r = noiseRng ?? Math.random;
    delta = delta.map((v) => v + noiseStd! * gauss(r));
  }
  return { delta, weights, noiseStd, method: cfg.method };
}
