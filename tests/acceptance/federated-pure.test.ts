import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROFILES, generate, generateHoldout } from "../../src/lib/federated/data";
import { gradient, loss, norm, trainLocal, zeros } from "../../src/lib/federated/model";
import { auc, evaluate, metricsOf } from "../../src/lib/federated/metrics";
import {
  DEFAULT_AGG, aggregate, cappedWeights, clipDelta, screenPoisoning, validateUpdate, type ValidationContext,
} from "../../src/lib/federated/aggregate";
import { dpReport, rdpToEpsilon } from "../../src/lib/federated/dp";
import { DEFAULT_RUN, runProgramme, type RunConfig } from "../../src/lib/federated/coordinator";
import { localClient, trainStandalone } from "../../src/lib/federated/client";
import { injectFault } from "../../src/lib/federated/faults";
import { DIM, SCHEMA_VERSION, type Example } from "../../src/lib/federated/types";

const rate = (d: Example[]) => d.filter((e) => e.y === 1).length / d.length;

describe("P2 synthetic data: reproducible and deliberately non-IID", () => {
  it("the same seed gives the same dataset, a different seed gives a different one", () => {
    expect(generate(PROFILES.balanced, 5)).toEqual(generate(PROFILES.balanced, 5));
    expect(generate(PROFILES.balanced, 5)).not.toEqual(generate(PROFILES.balanced, 6));
  });
  it("clients differ in label mix, as the profiles declare", () => {
    expect(rate(generate(PROFILES.seasonal_heavy, 1))).toBeGreaterThan(0.7);
    expect(rate(generate(PROFILES.genuine_heavy, 1))).toBeLessThan(0.3);
    expect(generate(PROFILES.dominant_skewed, 1).length).toBeGreaterThan(5 * generate(PROFILES.balanced, 1).length);
  });
  it("the holdout is balanced and shares no rows with a client dataset", () => {
    const hold = generateHoldout(999);
    expect(Math.abs(rate(hold) - 0.5)).toBeLessThan(0.06);
    const seen = new Set(generate(PROFILES.balanced, 100).map((e) => e.x[0]));
    expect(hold.some((e) => seen.has(e.x[0]))).toBe(false);
  });
});

describe("P2 model: logistic regression is implemented correctly", () => {
  const data = generate(PROFILES.balanced, 3).slice(0, 80);
  it("the analytic gradient matches a numerical gradient", () => {
    const w = [0.1, -0.2, 0.3, 0.05, -0.1, 0.2, -0.3];
    const g = gradient(w, data, 0.05);
    for (let j = 0; j < w.length; j++) {
      const h = 1e-5;
      const up = w.slice(); up[j] += h;
      const dn = w.slice(); dn[j] -= h;
      expect(g[j]).toBeCloseTo((loss(up, data, 0.05) - loss(dn, data, 0.05)) / (2 * h), 6);
    }
  });
  it("training reduces the loss and does not mutate its starting weights", () => {
    const start = zeros();
    const out = trainLocal(start, data, { epochs: 20, lr: 0.3, l2: 0.01 });
    expect(start).toEqual(zeros());
    expect(loss(out, data, 0.01)).toBeLessThan(loss(start, data, 0.01));
  });
});

describe("P2 metrics", () => {
  it("AUC: perfect, reversed, tied and single-class cases", () => {
    expect(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
    expect(auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1])).toBe(0);
    expect(auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1])).toBe(0.5);
    expect(auc([0.1, 0.9], [1, 1])).toBeNull();
  });
  it("log loss of an uninformative model is ln 2, accuracy and Brier are as expected", () => {
    const m = metricsOf([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1]);
    expect(m.logLoss).toBeCloseTo(Math.LN2, 9);
    expect(m.brier).toBeCloseTo(0.25, 9);
    expect(metricsOf([0.9, 0.1], [1, 0]).accuracy).toBe(1);
  });
  it("evaluation reports slices that partition the holdout", () => {
    const r = evaluate(zeros(), generateHoldout(2, 400));
    expect(r.slices.high_seasonality.n + r.slices.low_seasonality.n).toBe(r.n);
  });
});

describe("P2 aggregation: weights, clipping, trimmed mean", () => {
  it("capped weights sum to 1, respect the cap, and are proportional when nobody is capped", () => {
    const w = cappedWeights([100, 100, 800], 0.5);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(Math.max(...w)).toBeCloseTo(0.5, 9);
    expect(w[0]).toBeCloseTo(0.25, 9);
    const p = cappedWeights([100, 200, 300], 0.9);
    expect(p[2]).toBeCloseTo(0.5, 9);
  });
  it("an unreachable cap falls back to equal weights rather than failing", () => {
    expect(cappedWeights([1, 1000, 5], 0.1).every((x) => Math.abs(x - 1 / 3) < 1e-9)).toBe(true);
  });
  it("FedAvg is the weighted mean of the deltas", () => {
    const out = aggregate([{ ref: "a", delta: [1, 0], n: 100 }, { ref: "b", delta: [0, 1], n: 300 }], { ...DEFAULT_AGG, weightCap: 1 });
    expect(out.delta[0]).toBeCloseTo(0.25, 9);
    expect(out.delta[1]).toBeCloseTo(0.75, 9);
    expect(out.noiseStd).toBeNull();
  });
  it("trimmed mean ignores a single extreme value", () => {
    const items = [1, 1.1, 0.9, 1.05, 1000].map((v, i) => ({ ref: "c" + i, delta: [v], n: 10 }));
    const out = aggregate(items, { ...DEFAULT_AGG, method: "trimmed_mean", trimFraction: 0.2 });
    expect(out.delta[0]).toBeLessThan(1.2);
  });
  it("clipping bounds the norm and preserves direction; small updates pass unchanged", () => {
    const c = clipDelta([30, 40], 5);
    expect(norm(c.delta)).toBeCloseTo(5, 9);
    expect(c.delta[1] / c.delta[0]).toBeCloseTo(4 / 3, 9);
    expect(c.clipped).toBe(true);
    expect(clipDelta([0.3, 0.4], 5).clipped).toBe(false);
  });
  it("Gaussian noise has the documented scale", () => {
    const items = [0, 1, 2, 3].map((i) => ({ ref: "r" + i, delta: new Array(DIM).fill(0), n: 100 }));
    const cfg = { ...DEFAULT_AGG, dp: { noiseMultiplier: 2 } };
    const a = aggregate(items, cfg, () => 0.5);
    expect(a.noiseStd).toBeCloseTo(2 * cfg.clipNorm * 0.25, 9);
  });
});

describe("P2 update validation: every rejection has a reason code", () => {
  const ok = { schemaVersion: SCHEMA_VERSION, modelVersion: "m:v0", delta: new Array(DIM).fill(0.01), nExamples: 10 };
  const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
    schemaVersion: SCHEMA_VERSION, modelVersion: "m:v0", dim: DIM, enrolled: new Set(["a"]), seen: new Set(), clipNorm: 1.5, hardNormMultiple: 25, ...over,
  });
  it.each([
    ["accepted", "a", ok, {}, null],
    ["not enrolled", "z", ok, {}, "not_enrolled"],
    ["duplicate", "a", ok, { seen: new Set(["a"]) }, "duplicate"],
    ["wrong schema", "a", { ...ok, schemaVersion: "x" }, {}, "schema_version_mismatch"],
    ["stale model", "a", { ...ok, modelVersion: "m:v-1" }, {}, "model_version_mismatch"],
    ["wrong shape", "a", { ...ok, delta: [1, 2] }, {}, "shape_mismatch"],
    ["NaN", "a", { ...ok, delta: ok.delta.map((v, i) => (i ? v : NaN)) }, {}, "non_finite"],
    ["Infinity", "a", { ...ok, delta: ok.delta.map((v, i) => (i ? v : Infinity)) }, {}, "non_finite"],
    ["zero examples", "a", { ...ok, nExamples: 0 }, {}, "invalid_example_count"],
    ["fractional examples", "a", { ...ok, nExamples: 2.5 }, {}, "invalid_example_count"],
    ["absurd norm", "a", { ...ok, delta: ok.delta.map(() => 1e4) }, {}, "norm_exceeds_hard_limit"],
  ])("%s", (_n, ref, u, over, expected) => {
    expect(validateUpdate(ref, u, ctx(over as Partial<ValidationContext>))).toBe(expected);
  });
});

describe("P2 poisoning screen", () => {
  const honest = [[0.3, 0.2, 0.1], [0.28, 0.22, 0.09], [0.31, 0.19, 0.12]];
  const item = (ref: string, d: number[]) => ({ ref, delta: d, rawNorm: norm(d) });
  it("flags an amplified reversed update and a scaled-up update, and leaves honest ones alone", () => {
    const items = [...honest.map((d, i) => item("h" + i, d)), item("flip", [-0.9, -0.6, -0.3]), { ref: "big", delta: [0.3, 0.2, 0.1], rawNorm: 40 }];
    const s = screenPoisoning(items, DEFAULT_AGG);
    expect([...s].sort()).toEqual(["big", "flip"]);
  });
  it("does not reject honest clients that merely disagree near convergence (regression)", () => {
    const items = [item("a", [0.3, 0.1, 0]), item("b", [-0.28, -0.1, 0.01]), item("c", [0.05, 0.02, 0.3])];
    expect(screenPoisoning(items, DEFAULT_AGG).size).toBe(0);
  });
  it("screens nothing with fewer than three updates (no meaningful median)", () => {
    expect(screenPoisoning([item("a", [1, 1, 1]), item("b", [-9, -9, -9])], DEFAULT_AGG).size).toBe(0);
  });
});

describe("P2 privacy accountant: declared, closed-form, and honest about its assumptions", () => {
  const closed = (sigma: number, T: number, delta: number) => {
    const L = Math.log(1 / delta);
    return T / (2 * sigma ** 2) + 2 * Math.sqrt((T * L) / (2 * sigma ** 2));
  };
  it("matches the analytic optimum of the RDP conversion (grid minimum is never below it, and within 1%)", () => {
    for (const [sigma, T] of [[1, 8], [2, 20], [0.8, 5]] as const) {
      const e = rdpToEpsilon(sigma, T, 1e-5);
      expect(e).toBeGreaterThanOrEqual(closed(sigma, T, 1e-5) - 1e-9);
      expect(e / closed(sigma, T, 1e-5)).toBeLessThan(1.01);
    }
  });
  it("more rounds spend more privacy; more noise spends less", () => {
    expect(rdpToEpsilon(1, 16, 1e-5)).toBeGreaterThan(rdpToEpsilon(1, 8, 1e-5));
    expect(rdpToEpsilon(2, 8, 1e-5)).toBeLessThan(rdpToEpsilon(1, 8, 1e-5));
  });
  it("the report states its trust assumption and that this is not secure aggregation", () => {
    const text = dpReport({ noiseMultiplier: 1, clipNorm: 1.5, maxWeight: 0.5, rounds: 8 }).assumptions.join(" ");
    expect(text).toMatch(/coordinator is trusted/i);
    expect(text).toMatch(/not secure aggregation/i);
  });
});

describe("P2 coordinator: federated training under heterogeneity, faults and skew", () => {
  const hold = generateHoldout(999);
  const names = ["seasonal_heavy", "genuine_heavy", "balanced", "small_noisy"] as const;
  const data = names.map((n, i) => generate(PROFILES[n], 100 + i));
  const clients = () => names.map((n, i) => localClient("c" + i, data[i]));
  const cfg: RunConfig = { ...DEFAULT_RUN, versionPrefix: "t" };
  const finalOf = (r: Awaited<ReturnType<typeof runProgramme>>) => r.rounds[r.rounds.length - 1].holdout;

  it("the federated model beats the untrained model and every client trained alone on skewed or small data", async () => {
    const res = await runProgramme({ clients: clients(), holdout: hold, config: cfg });
    const fed = finalOf(res);
    expect(fed.logLoss).toBeLessThan(res.baselineZero.logLoss - 0.15);
    expect(fed.accuracy).toBeGreaterThan(0.78);
    for (const i of [0, 1, 3]) {
      const alone = evaluate(trainStandalone(data[i], cfg.local, cfg.rounds), hold);
      expect(fed.accuracy).toBeGreaterThan(alone.accuracy);
      expect(fed.logLoss).toBeLessThan(alone.logLoss);
    }
    // No centralised reference is run; the claim is only the comparison above.
    expect(res.dp).toBeNull();
  });

  it("is deterministic for a given configuration", async () => {
    const a = await runProgramme({ clients: clients(), holdout: hold, config: cfg });
    const b = await runProgramme({ clients: clients(), holdout: hold, config: cfg });
    expect(a.finalWeights).toEqual(b.finalWeights);
  });

  it("a very large skewed client dominates plain weighting; the weight cap protects the model", async () => {
    const withDom = [...clients(), localClient("dom", generate(PROFILES.dominant_skewed, 7))];
    const run = (weightCap: number) => runProgramme({ clients: withDom, holdout: hold, config: { ...cfg, agg: { ...cfg.agg, weightCap } } });
    const uncapped = await run(1);
    const capped = await run(0.25);
    expect(uncapped.rounds[0].participants.find((p) => p.ref === "dom")!.weight!).toBeGreaterThan(0.6);
    expect(finalOf(capped).accuracy).toBeGreaterThan(finalOf(uncapped).accuracy + 0.05);
    expect(finalOf(capped).logLoss).toBeLessThan(finalOf(uncapped).logLoss - 0.05);
  });

  it("a client that drops out is recorded as dropped and the round still completes with the rest", async () => {
    const cs = [...clients().slice(0, 3), injectFault(clients()[3], "dropout")];
    const res = await runProgramme({ clients: cs, holdout: hold, config: cfg });
    expect(res.rounds.every((r) => r.status === "completed")).toBe(true);
    expect(res.rounds[0].participants[3]).toMatchObject({ status: "dropped", reason: "no_response" });
    expect(finalOf(res).accuracy).toBeGreaterThan(0.78);
  });

  it("below the minimum cohort the round is abandoned and the model version does not change", async () => {
    const cs = [clients()[0], clients()[1], injectFault(clients()[2], "dropout"), injectFault(clients()[3], "dropout")];
    const res = await runProgramme({ clients: cs, holdout: hold, config: cfg });
    expect(res.rounds.every((r) => r.status === "abandoned" && r.abandonReason === "below_minimum_cohort")).toBe(true);
    expect(res.finalVersion).toBe("t:v0");
    expect(res.finalWeights).toEqual(zeros());
    expect(res.rounds[0].participants.filter((p) => p.reason === "cohort_below_minimum")).toHaveLength(2);
  });

  it.each([
    ["wrong_schema", "schema_version_mismatch"],
    ["wrong_model_version", "model_version_mismatch"],
    ["non_finite", "non_finite"],
  ] as const)("an invalid update (%s) is rejected with its reason and excluded", async (fault, reason) => {
    const cs = [...clients().slice(0, 3), injectFault(clients()[3], fault)];
    const res = await runProgramme({ clients: cs, holdout: hold, config: cfg });
    expect(res.rounds[0].participants[3]).toMatchObject({ status: "rejected", reason });
    expect(res.rounds[0].participants[3].weight).toBeUndefined();
  });

  it("a scaled-up poisoned update never enters the aggregate", async () => {
    const cs = [...clients().slice(0, 3), injectFault(clients()[3], "scale_up")];
    const res = await runProgramme({ clients: cs, holdout: hold, config: cfg });
    for (const r of res.rounds) expect(r.participants[3].status).toBe("rejected");
    expect(finalOf(res).accuracy).toBeGreaterThan(0.78);
  });

  it("a sign-flip poisoner is screened and the final model stays close to the clean run; without the screen it does not", async () => {
    const clean = await runProgramme({ clients: clients(), holdout: hold, config: cfg });
    const attacked = [...clients(), injectFault(localClient("x", data[2]), "sign_flip")];
    const screened = await runProgramme({ clients: attacked, holdout: hold, config: cfg });
    const unscreened = await runProgramme({ clients: attacked, holdout: hold, config: { ...cfg, agg: { ...cfg.agg, cosineMin: -2, normMultiple: 1e9 } } });
    // The screen is not perfect (early rounds can pass), so the claim is about the outcome, stated with a margin.
    expect(screened.rounds[screened.rounds.length - 1].participants[4].status).toBe("rejected");
    expect(finalOf(screened).accuracy).toBeGreaterThan(finalOf(clean).accuracy - 0.06);
    expect(finalOf(unscreened).accuracy).toBeLessThan(finalOf(screened).accuracy - 0.08);
  });

  it("trimmed mean limits a poisoner even with the screen turned off", async () => {
    const attacked = [...clients(), injectFault(localClient("x", data[2]), "sign_flip")];
    const off = { cosineMin: -2, normMultiple: 1e9 };
    const avg = await runProgramme({ clients: attacked, holdout: hold, config: { ...cfg, agg: { ...cfg.agg, ...off } } });
    const trimmed = await runProgramme({ clients: attacked, holdout: hold, config: { ...cfg, agg: { ...cfg.agg, ...off, method: "trimmed_mean" } } });
    expect(finalOf(trimmed).accuracy).toBeGreaterThan(finalOf(avg).accuracy + 0.05);
  });

  it("with noise enabled, the run carries a privacy report and is reproducible by seed; without noise, none", async () => {
    const noisy: RunConfig = { ...cfg, agg: { ...cfg.agg, dp: { noiseMultiplier: 1 } } };
    const withNoise = await runProgramme({ clients: clients(), holdout: hold, config: noisy });
    expect(withNoise.dp).not.toBeNull();
    expect(withNoise.dp!.rounds).toBe(8);
    expect(withNoise.dp!.epsilon).toBeGreaterThan(1);
    expect(withNoise.rounds[0].aggregation!.noiseStd).toBeGreaterThan(0);
    const again = await runProgramme({ clients: clients(), holdout: hold, config: noisy });
    expect(again.finalWeights).toEqual(withNoise.finalWeights);
    const plain = await runProgramme({ clients: clients(), holdout: hold, config: cfg });
    expect(plain.dp).toBeNull();
  });

  it("round records are metadata only: no feature value or label appears in what the coordinator logs", async () => {
    const res = await runProgramme({ clients: clients(), holdout: hold, config: cfg });
    const log = JSON.stringify(res.rounds.map((r) => ({ ...r, holdout: undefined })));
    for (const d of data) for (const e of d.slice(0, 40)) for (const v of e.x) expect(log.includes(String(v))).toBe(false);
    expect(Object.keys(res.rounds[0].participants[0]).sort()).toEqual(["clipped", "clippedNorm", "nExamples", "rawNorm", "ref", "status", "weight"]);
  });

  it("the coordinator and aggregation modules have no way to reach client data (static import rule)", () => {
    for (const f of ["coordinator.ts", "aggregate.ts", "dp.ts"]) {
      const src = readFileSync(`src/lib/federated/${f}`, "utf8");
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const i of imports) {
        expect(i, `${f} imports ${i}`).toMatch(/^\.\/(aggregate|dp|metrics|model|prng|types)$/);
      }
    }
  });
});
