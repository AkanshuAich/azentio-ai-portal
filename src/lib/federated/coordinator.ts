import { DEFAULT_AGG, aggregate, clipDelta, screenPoisoning, validateUpdate, type AggConfig, type RejectReason } from "./aggregate";
import { dpReport, type DpReport } from "./dp";
import { evaluate } from "./metrics";
import { add, zeros } from "./model";
import { rng, type Rng } from "./prng";
import { DIM, SCHEMA_VERSION, type ClientHandle, type EvalReport, type Example, type LocalConfig, type Weights } from "./types";

/**
 * The coordinator. It holds the global weights, asks each client to train locally, and aggregates what comes back.
 * It is given only ClientHandle objects (a pseudonymous ref and a train() function) and a separate synthetic
 * holdout. It has no way to read any client's examples, and it logs metadata only.
 */
export interface RunConfig {
  rounds: number;
  local: LocalConfig;
  agg: AggConfig;
  /** Seeds the DP noise so a run can be reproduced. */
  seed: number;
  versionPrefix: string;
}

export const DEFAULT_RUN: Omit<RunConfig, "versionPrefix"> = {
  rounds: 8, local: { epochs: 4, lr: 0.4, l2: 0.01 }, agg: DEFAULT_AGG, seed: 1,
};

export type ParticipantStatus = "accepted" | "rejected" | "dropped";
export interface ParticipantRecord {
  ref: string;
  status: ParticipantStatus;
  reason?: RejectReason | "no_response" | "cohort_below_minimum";
  nExamples?: number;
  rawNorm?: number;
  clippedNorm?: number;
  clipped?: boolean;
  weight?: number;
}

export interface RoundRecord {
  round: number;
  modelVersionBefore: string;
  modelVersionAfter: string;
  status: "completed" | "abandoned";
  abandonReason?: "below_minimum_cohort";
  participants: ParticipantRecord[];
  aggregation: { method: AggConfig["method"]; noiseStd: number | null } | null;
  holdout: EvalReport;
}

export interface RunResult {
  rounds: RoundRecord[];
  finalWeights: Weights;
  finalVersion: string;
  /** The starting model (all zeros), for comparison. */
  baselineZero: EvalReport;
  /** Present only if noise was enabled. When null, the run carries NO formal privacy claim. */
  dp: DpReport | null;
  config: RunConfig;
}

const versionOf = (prefix: string, n: number) => `${prefix}:v${n}`;

export async function runProgramme(args: {
  clients: ClientHandle[];
  holdout: Example[];
  config: RunConfig;
  initial?: Weights;
  schemaVersion?: string;
  noiseRng?: Rng;
}): Promise<RunResult> {
  const { clients, holdout, config } = args;
  const schemaVersion = args.schemaVersion ?? SCHEMA_VERSION;
  const noiseRng = args.noiseRng ?? rng(config.seed);
  const enrolled = new Set(clients.map((c) => c.ref));
  let w: Weights = args.initial ?? zeros();
  let version = 0;
  const rounds: RoundRecord[] = [];
  let maxWeightSeen = 0;

  const baselineZero = evaluate(w, holdout);

  for (let r = 1; r <= config.rounds; r++) {
    const before = versionOf(config.versionPrefix, version);
    const settled = await Promise.allSettled(clients.map((c) => c.train(w, before, config.local)));
    const participants: ParticipantRecord[] = [];
    const seen = new Set<string>();
    const valid: { ref: string; delta: number[]; n: number; rawNorm: number }[] = [];

    settled.forEach((s, i) => {
      const ref = clients[i].ref;
      if (s.status === "rejected") {
        // The error text is deliberately not recorded: it could echo client-side data.
        participants.push({ ref, status: "dropped", reason: "no_response" });
        return;
      }
      const u = s.value;
      const reason = validateUpdate(ref, u, { schemaVersion, modelVersion: before, dim: DIM, enrolled, seen, clipNorm: config.agg.clipNorm, hardNormMultiple: config.agg.hardNormMultiple });
      seen.add(ref);
      if (reason) { participants.push({ ref, status: "rejected", reason }); return; }
      const c = clipDelta(u.delta, config.agg.clipNorm);
      valid.push({ ref, delta: c.delta, n: u.nExamples, rawNorm: c.rawNorm });
      participants.push({ ref, status: "accepted", nExamples: u.nExamples, rawNorm: c.rawNorm, clippedNorm: c.clippedNorm, clipped: c.clipped });
    });

    // Cohort screen on the clipped updates; suspects are rejected and logged.
    const suspects = screenPoisoning(valid, config.agg);
    const kept = valid.filter((v) => !suspects.has(v.ref));
    for (const p of participants) if (p.status === "accepted" && suspects.has(p.ref)) { p.status = "rejected"; p.reason = "poisoning_suspected"; }

    if (kept.length < config.agg.minCohort) {
      for (const p of participants) if (p.status === "accepted") { p.status = "rejected"; p.reason = "cohort_below_minimum"; }
      rounds.push({ round: r, modelVersionBefore: before, modelVersionAfter: before, status: "abandoned", abandonReason: "below_minimum_cohort", participants, aggregation: null, holdout: evaluate(w, holdout) });
      continue;
    }

    const agg = aggregate(kept.map((k) => ({ ref: k.ref, delta: k.delta, n: k.n })), config.agg, noiseRng);
    w = add(w, agg.delta);
    version++;
    for (const p of participants) if (p.status === "accepted") p.weight = agg.weights[p.ref];
    maxWeightSeen = Math.max(maxWeightSeen, ...Object.values(agg.weights));
    rounds.push({ round: r, modelVersionBefore: before, modelVersionAfter: versionOf(config.versionPrefix, version), status: "completed", participants, aggregation: { method: agg.method, noiseStd: agg.noiseStd }, holdout: evaluate(w, holdout) });
  }

  const completed = rounds.filter((x) => x.status === "completed").length;
  const dp = config.agg.dp && config.agg.method === "fedavg" && completed > 0
    ? dpReport({ noiseMultiplier: config.agg.dp.noiseMultiplier, clipNorm: config.agg.clipNorm, maxWeight: maxWeightSeen, rounds: completed })
    : null;

  return { rounds, finalWeights: w, finalVersion: versionOf(config.versionPrefix, version), baselineZero, dp, config };
}
