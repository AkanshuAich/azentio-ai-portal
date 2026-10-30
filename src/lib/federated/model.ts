import { DIM, type Example, type LocalConfig, type Weights } from "./types";

/** L2-regularised logistic regression. Convex, small, and easy to reason about. */
export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export const zeros = (): Weights => new Array(DIM).fill(0);

export function logit(w: Weights, x: number[]): number {
  let z = w[0];
  for (let j = 0; j < x.length; j++) z += w[j + 1] * x[j];
  return z;
}

export const predictProba = (w: Weights, x: number[]) => sigmoid(logit(w, x));

const EPS = 1e-12;

/** Mean log loss plus (l2/2)·||w||² (the bias is not penalised). */
export function loss(w: Weights, data: Example[], l2: number): number {
  let s = 0;
  for (const e of data) {
    const p = Math.min(1 - EPS, Math.max(EPS, predictProba(w, e.x)));
    s += e.y === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  let reg = 0;
  for (let j = 1; j < w.length; j++) reg += w[j] * w[j];
  return s / data.length + (l2 / 2) * reg;
}

export function gradient(w: Weights, data: Example[], l2: number): number[] {
  const g = new Array(w.length).fill(0);
  for (const e of data) {
    const err = predictProba(w, e.x) - e.y;
    g[0] += err;
    for (let j = 0; j < e.x.length; j++) g[j + 1] += err * e.x[j];
  }
  for (let j = 0; j < g.length; j++) g[j] /= data.length;
  for (let j = 1; j < g.length; j++) g[j] += l2 * w[j];
  return g;
}

/** Full-batch gradient descent from `start`. Returns new weights. */
export function trainLocal(start: Weights, data: Example[], cfg: LocalConfig): Weights {
  const w = start.slice();
  for (let epoch = 0; epoch < cfg.epochs; epoch++) {
    const g = gradient(w, data, cfg.l2);
    for (let j = 0; j < w.length; j++) w[j] -= cfg.lr * g[j];
  }
  return w;
}

export const subtract = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
export const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
export const norm = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));
export const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
export const scale = (a: number[], k: number) => a.map((v) => v * k);
export const cosine = (a: number[], b: number[]) => {
  const d = norm(a) * norm(b);
  return d === 0 ? 0 : dot(a, b) / d;
};
