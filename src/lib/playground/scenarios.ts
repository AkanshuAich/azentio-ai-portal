import { z } from "zod";

// Guided sandbox scenarios. Everything here is deterministic and runs on synthetic data generated
// in-process: no model is called, no real customer data is read, and every output is labelled as simulated.

export const SANDBOX_LABEL = "SAMPLE DATA · SIMULATED OUTPUT";
export const SANDBOX_DISCLAIMER =
  "This is a sandbox demonstration on synthetic data. It is not an approved credit or business decision.";

export interface FieldMeta {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  help: string;
}

export interface ScenarioMeta {
  id: string;
  /** Product slug, so client entitlements (Phase 4) can gate the same scenario. */
  productSlug: string;
  title: string;
  blurb: string;
  inputsNote: string;
  fields: FieldMeta[];
}

export interface Metric {
  label: string;
  value: string;
  note?: string;
}

export interface ScenarioOutput {
  label: typeof SANDBOX_LABEL;
  disclaimer: string;
  headline: string;
  metrics: Metric[];
  evidence: {
    method: string;
    steps: string[];
    table?: { columns: string[]; rows: (string | number)[][] };
  };
}

// --- deterministic synthetic data -------------------------------------------------------------------

/** mulberry32: a tiny seeded PRNG so the same inputs always give the same synthetic portfolio. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticApplicant {
  id: string;
  segment: "SME" | "Retail";
  score: number;
  amount: number;
  pd: number;
}

export function syntheticPortfolio(n = 240): SyntheticApplicant[] {
  const r = rng(42);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  return Array.from({ length: n }, (_, i) => {
    const score = Math.max(300, Math.min(850, Math.round(650 + 70 * gauss())));
    const segment = r() < 0.45 ? "SME" : "Retail";
    const amount = Math.round((segment === "SME" ? 40_000 + r() * 210_000 : 5_000 + r() * 45_000) / 500) * 500;
    // Synthetic probability of default, falling as score rises.
    const pd = 1 / (1 + Math.exp((score - 560) / 45));
    return { id: `SYN-${String(i + 1).padStart(4, "0")}`, segment, score, amount, pd: Math.round(pd * 10000) / 10000 };
  });
}

const money = (v: number) => `${Math.round(v).toLocaleString("en-US")}`;
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

// --- scenario 1: credit strategy simulator ----------------------------------------------------------

const LGD = 0.45;
const BASELINE_CUTOFF = 650;

export const creditStrategyParams = z.object({
  scoreCutoff: z.number().int().min(500).max(800),
  segment: z.number().int().min(0).max(2), // 0 = all, 1 = SME, 2 = Retail
});

function runCreditStrategy(p: z.infer<typeof creditStrategyParams>): ScenarioOutput {
  const all = syntheticPortfolio();
  const pool = p.segment === 0 ? all : all.filter((a) => a.segment === (p.segment === 1 ? "SME" : "Retail"));
  const evaluate = (cutoff: number) => {
    const approved = pool.filter((a) => a.score >= cutoff);
    const exposure = approved.reduce((s, a) => s + a.amount, 0);
    const expectedLoss = approved.reduce((s, a) => s + a.amount * a.pd * LGD, 0);
    return { approved, exposure, expectedLoss };
  };
  const base = evaluate(BASELINE_CUTOFF);
  const next = evaluate(p.scoreCutoff);
  const delta = next.approved.length - base.approved.length;

  return {
    label: SANDBOX_LABEL,
    disclaimer: SANDBOX_DISCLAIMER,
    headline:
      `At a cutoff of ${p.scoreCutoff}, ${next.approved.length} of ${pool.length} synthetic applicants pass ` +
      `(${delta >= 0 ? "+" : ""}${delta} versus the ${BASELINE_CUTOFF} baseline).`,
    metrics: [
      { label: "Approval rate", value: pct(next.approved.length / pool.length), note: `baseline ${pct(base.approved.length / pool.length)}` },
      { label: "Approved exposure", value: money(next.exposure), note: `baseline ${money(base.exposure)} (synthetic currency units)` },
      { label: "Expected loss", value: money(next.expectedLoss), note: `baseline ${money(base.expectedLoss)}` },
      { label: "Loss rate on exposure", value: pct(next.exposure ? next.expectedLoss / next.exposure : 0, 2), note: `baseline ${pct(base.exposure ? base.expectedLoss / base.exposure : 0, 2)}` },
    ],
    evidence: {
      method: "Replay a fixed synthetic portfolio under two score cutoffs and compare.",
      steps: [
        `Portfolio: ${all.length} synthetic applicants generated from a fixed seed, so every run is repeatable.`,
        `Pool: ${p.segment === 0 ? "all segments" : p.segment === 1 ? "SME only" : "Retail only"} (${pool.length} applicants).`,
        "An applicant passes when score is at or above the cutoff.",
        `Expected loss = amount x synthetic probability of default x ${LGD} loss-given-default, summed over approved applicants.`,
      ],
      table: {
        columns: ["Applicant", "Segment", "Score", "Amount", "Synthetic PD", "Result"],
        rows: pool.slice(0, 8).map((a) => [a.id, a.segment, a.score, money(a.amount), pct(a.pd, 2), a.score >= p.scoreCutoff ? "pass" : "below cutoff"]),
      },
    },
  };
}

// --- scenario 2: SME credit decisioning -------------------------------------------------------------

export const smeDecisioningParams = z.object({
  revenue: z.number().int().min(100_000).max(20_000_000),
  ebitdaMarginPct: z.number().int().min(-10).max(40),
  debt: z.number().int().min(0).max(30_000_000),
  currentRatioX100: z.number().int().min(40).max(400),
});

function runSmeDecisioning(p: z.infer<typeof smeDecisioningParams>): ScenarioOutput {
  const ebitda = (p.revenue * p.ebitdaMarginPct) / 100;
  const leverage = ebitda > 0 ? p.debt / ebitda : Infinity;
  const currentRatio = p.currentRatioX100 / 100;
  const rules = [
    { rule: "EBITDA margin at least 8%", pass: p.ebitdaMarginPct >= 8, actual: `${p.ebitdaMarginPct}%` },
    { rule: "Debt / EBITDA at most 3.5x", pass: leverage <= 3.5, actual: Number.isFinite(leverage) ? `${leverage.toFixed(2)}x` : "n/a (non-positive EBITDA)" },
    { rule: "Current ratio at least 1.2", pass: currentRatio >= 1.2, actual: currentRatio.toFixed(2) },
  ];
  const failed = rules.filter((r) => !r.pass).length;
  // The wording is deliberately a referral, never an approval or a decline.
  const suggestion = failed === 0 ? "Suggest: proceed to human review" : failed === 1 ? "Suggest: refer with conditions to human review" : "Suggest: flag for senior human review";

  return {
    label: SANDBOX_LABEL,
    disclaimer: SANDBOX_DISCLAIMER,
    headline: `${suggestion}. ${rules.length - failed} of ${rules.length} policy checks met.`,
    metrics: [
      { label: "EBITDA", value: money(ebitda), note: "revenue x margin" },
      { label: "Debt / EBITDA", value: Number.isFinite(leverage) ? `${leverage.toFixed(2)}x` : "n/a" },
      { label: "Current ratio", value: currentRatio.toFixed(2) },
      { label: "Checks met", value: `${rules.length - failed} / ${rules.length}` },
    ],
    evidence: {
      method: "Apply three illustrative policy rules to the inputs and show each result. A person makes the decision.",
      steps: [
        "Rules are illustrative sandbox rules, not any institution's real credit policy.",
        "Each rule is evaluated independently so the reason for a referral is visible.",
        "The output is decision support. A named approver reviews and decides.",
      ],
      table: { columns: ["Policy check", "Actual", "Result"], rows: rules.map((r) => [r.rule, r.actual, r.pass ? "met" : "not met"]) },
    },
  };
}

// --- scenario 3: financial analysis with seasonality ------------------------------------------------

export const seasonalityParams = z.object({
  baseRevenue: z.number().int().min(100_000).max(10_000_000),
  seasonalityPct: z.number().int().min(0).max(60),
  annualGrowthPct: z.number().int().min(-10).max(30),
});

const SEASON_SHAPE = [0.35, -0.2, -0.45, 0.3]; // relative quarterly pattern, Q1..Q4

function runSeasonality(p: z.infer<typeof seasonalityParams>): ScenarioOutput {
  const quarters = Array.from({ length: 7 }, (_, t) => {
    const trend = Math.pow(1 + p.annualGrowthPct / 100, t / 4);
    const season = 1 + (p.seasonalityPct / 100) * SEASON_SHAPE[t % 4] * 1.4;
    return { label: `Y${Math.floor(t / 4) + 1} Q${(t % 4) + 1}`, revenue: Math.round(p.baseRevenue * trend * season) };
  });
  // Latest quarter is Y2 Q3, a seasonal low, so the naive and seasonal readings can disagree.
  const last = quarters[6];
  const prior = quarters[5];
  const sameQuarterLastYear = quarters[2];
  const qoq = last.revenue / prior.revenue - 1;
  const yoy = last.revenue / sameQuarterLastYear.revenue - 1;
  const misleading = qoq < -0.05 && yoy >= 0;

  return {
    label: SANDBOX_LABEL,
    disclaimer: SANDBOX_DISCLAIMER,
    headline: misleading
      ? `Quarter-on-quarter shows ${pct(qoq)}, which reads as deterioration, but the same quarter last year shows ${pct(yoy)}.`
      : `Quarter-on-quarter is ${pct(qoq)} and same-quarter year-on-year is ${pct(yoy)}.`,
    metrics: [
      { label: "QoQ change (naive)", value: pct(qoq), note: "compares with the prior quarter, ignoring season" },
      { label: "YoY change (seasonal baseline)", value: pct(yoy), note: "compares with the same quarter a year earlier" },
      { label: "Seasonality strength", value: `${p.seasonalityPct}%` },
    ],
    evidence: {
      method: "Compare the latest quarter against the prior quarter and against the same quarter a year earlier.",
      steps: [
        "Seven quarters of synthetic revenue are generated from trend growth plus a fixed seasonal pattern.",
        "A naive reading uses the prior quarter. A seasonality-aware reading uses the same quarter last year.",
        misleading
          ? "Here the two disagree: the apparent decline is explained by the season, not by weaker performance."
          : "Here the two readings broadly agree. Raise seasonality to see them diverge.",
        "This illustrates an idea under review; it is not a delivered product capability.",
      ],
      table: { columns: ["Quarter", "Synthetic revenue"], rows: quarters.map((q) => [q.label, money(q.revenue)]) },
    },
  };
}

// --- registry ---------------------------------------------------------------------------------------

type Runner = { meta: ScenarioMeta; parse: (v: unknown) => Record<string, number>; run: (p: never) => ScenarioOutput };

function def<S extends z.ZodType<Record<string, number>>>(meta: ScenarioMeta, schema: S, run: (p: z.infer<S>) => ScenarioOutput): Runner {
  return { meta, parse: (v) => schema.parse(v), run: run as unknown as Runner["run"] };
}

export const SCENARIOS: Runner[] = [
  def(
    {
      id: "credit-strategy-simulator",
      productSlug: "credit-strategy-simulator",
      title: "Credit Strategy Simulator",
      blurb: "Move the score cutoff and see the effect on approvals, exposure and expected loss.",
      inputsNote: "Inputs: a fixed synthetic portfolio of 240 fictional applicants. Change the cutoff and segment.",
      fields: [
        { name: "scoreCutoff", label: "Score cutoff", min: 500, max: 800, step: 10, default: 620, help: "Applicants at or above this score pass. Baseline is 650." },
        { name: "segment", label: "Segment (0 all, 1 SME, 2 Retail)", min: 0, max: 2, step: 1, default: 0, help: "Restricts the synthetic pool." },
      ],
    },
    creditStrategyParams,
    runCreditStrategy,
  ),
  def(
    {
      id: "sme-credit-decisioning",
      productSlug: "sme-credit-decisioning",
      title: "SME Credit Decisioning Workbench",
      blurb: "Enter a fictional SME's figures and see each policy check, with a recommendation for a human to review.",
      inputsNote: "Inputs: figures for a fictional SME. Rules are illustrative, not a real credit policy.",
      fields: [
        { name: "revenue", label: "Annual revenue", min: 100_000, max: 20_000_000, step: 50_000, default: 2_400_000, help: "Synthetic currency units." },
        { name: "ebitdaMarginPct", label: "EBITDA margin (%)", min: -10, max: 40, step: 1, default: 11, help: "Earnings before interest, tax, depreciation and amortisation, as a share of revenue." },
        { name: "debt", label: "Total debt", min: 0, max: 30_000_000, step: 50_000, default: 700_000, help: "Synthetic currency units." },
        { name: "currentRatioX100", label: "Current ratio x100", min: 40, max: 400, step: 5, default: 135, help: "135 means a current ratio of 1.35." },
      ],
    },
    smeDecisioningParams,
    runSmeDecisioning,
  ),
  def(
    {
      id: "financial-analysis-intelligence",
      productSlug: "financial-analysis-intelligence",
      title: "Financial Analysis: seasonality context",
      blurb: "See how a quarter-on-quarter comparison can mislead for a seasonal business, and what a same-quarter comparison shows.",
      inputsNote: "Inputs: a fictional seasonal business. Seven quarters of revenue are generated for you.",
      fields: [
        { name: "baseRevenue", label: "Base quarterly revenue", min: 100_000, max: 10_000_000, step: 50_000, default: 1_000_000, help: "Synthetic currency units." },
        { name: "seasonalityPct", label: "Seasonality strength (%)", min: 0, max: 60, step: 5, default: 40, help: "How strongly revenue swings with the season." },
        { name: "annualGrowthPct", label: "Annual growth (%)", min: -10, max: 30, step: 1, default: 6, help: "Underlying trend growth." },
      ],
    },
    seasonalityParams,
    runSeasonality,
  ),
];

export function getScenario(id: string): Runner | undefined {
  return SCENARIOS.find((s) => s.meta.id === id);
}

export const feedbackSchema = z.object({
  helpful: z.boolean(),
  accuracy: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional().transform((v) => v || undefined),
});
