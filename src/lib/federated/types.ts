// Federated programme (P2): shared types. Everything in this folder uses SYNTHETIC data only.

/** Versioned feature schema. A client update is accepted only for the schema it was trained against. */
export const SCHEMA_VERSION = "seasonality_v1";

/**
 * Features are already standardised with fixed, documented constants (never statistics computed from anyone's
 * data), so clients need to share nothing to agree on scaling.
 *  qoq_change         quarter-on-quarter revenue change, in units of 25 percentage points
 *  yoy_change         same-quarter year-on-year change, same units
 *  seasonal_strength  estimated strength of seasonality, centred on 0.5, units of 0.25
 *  revenue_volatility volatility of recent revenue, standardised
 *  leverage           debt / EBITDA, standardised
 *  current_ratio      current ratio, standardised
 * Missing values are not allowed: a record with a missing feature is dropped by the client before training.
 */
export const FEATURES = ["qoq_change", "yoy_change", "seasonal_strength", "revenue_volatility", "leverage", "current_ratio"] as const;
export const N_FEATURES = FEATURES.length;
/** Weights are [bias, w1..w6]. */
export const DIM = N_FEATURES + 1;

/**
 * The learning task: given a quarter that looks like a decline quarter-on-quarter, is it a SEASONAL ARTEFACT
 * (label 1: same-quarter comparison is fine) or a GENUINE deterioration (label 0)?
 */
export interface Example { x: number[]; y: 0 | 1 }
export type Weights = number[];

export interface LocalConfig { epochs: number; lr: number; l2: number }

/** What a client sends back. Numbers only: no examples, no labels, no identifiers. */
export interface ClientUpdate {
  schemaVersion: string;
  modelVersion: string;
  delta: number[];
  nExamples: number;
}

export interface ClientHandle {
  /** Pseudonymous reference used in logs. Never an organisation name or id. */
  ref: string;
  train(global: Weights, modelVersion: string, cfg: LocalConfig): Promise<ClientUpdate>;
}

export interface Metrics {
  n: number;
  auc: number | null;
  accuracy: number;
  logLoss: number;
  brier: number;
  /** Expected calibration error over 10 equal-width bins. */
  ece: number;
}
export interface EvalReport extends Metrics {
  slices: Record<string, Metrics>;
}
