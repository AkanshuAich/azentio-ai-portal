import { gauss, rng } from "./prng";
import { N_FEATURES, type Example } from "./types";

/**
 * Synthetic data generator. Not a model of any real business: it exists to give the programme a learnable,
 * deliberately NON-IID task. Both classes show a negative quarter-on-quarter change (so that feature alone cannot
 * separate them). A seasonal artefact has a non-negative year-on-year change and high seasonality; a genuine
 * deterioration has a negative year-on-year change and low seasonality. The last two features are pure noise.
 */
export interface Profile {
  name: string;
  description: string;
  n: number;
  /** Base rate of label 1 (seasonal artefact) in this client's data: label skew. */
  pArtefact: number;
  /** Feature noise: higher is harder. */
  noise: number;
  /** Probability a label is flipped. */
  labelNoise: number;
  /** Per-feature shift: covariate skew between clients. */
  shift: number[];
}

export const PROFILES: Record<string, Profile> = {
  seasonal_heavy: { name: "seasonal_heavy", description: "Mostly seasonal artefacts (80%)", n: 400, pArtefact: 0.8, noise: 1.0, labelNoise: 0.02, shift: [0, 0, 0, 0, 0.4, -0.2] },
  genuine_heavy: { name: "genuine_heavy", description: "Mostly genuine deteriorations (80%)", n: 400, pArtefact: 0.2, noise: 1.0, labelNoise: 0.02, shift: [0, 0, 0, 0.3, -0.3, 0.2] },
  balanced: { name: "balanced", description: "Even mix, slightly noisier", n: 300, pArtefact: 0.5, noise: 1.15, labelNoise: 0.03, shift: [0, 0, 0, 0, 0, 0] },
  small_noisy: { name: "small_noisy", description: "Small and noisy (60 examples, 10% label noise)", n: 60, pArtefact: 0.5, noise: 1.5, labelNoise: 0.1, shift: [0, 0, 0, -0.3, 0.3, 0] },
  // For the skewed-clients demonstration: one very large client with an extreme label mix.
  dominant_skewed: { name: "dominant_skewed", description: "Very large, 95% seasonal artefacts", n: 2400, pArtefact: 0.95, noise: 1.0, labelNoise: 0.01, shift: [0, 0, 0, 0, 0.5, 0.5] },
};

export const PROFILE_NAMES = Object.keys(PROFILES);

const MEAN_ARTEFACT = [-0.8, 0.5, 0.9, 0.5, 0, 0];
const MEAN_GENUINE = [-0.8, -0.7, -0.3, 0.1, 0, 0];

export function generate(profile: Profile, seed: number): Example[] {
  const r = rng(seed);
  const out: Example[] = [];
  for (let i = 0; i < profile.n; i++) {
    const truth = r() < profile.pArtefact ? 1 : 0;
    const mean = truth === 1 ? MEAN_ARTEFACT : MEAN_GENUINE;
    const x = Array.from({ length: N_FEATURES }, (_, j) => mean[j] + profile.shift[j] + profile.noise * gauss(r));
    const y = (r() < profile.labelNoise ? 1 - truth : truth) as 0 | 1;
    out.push({ x, y });
  }
  return out;
}

/** The separate evaluation set: balanced, unshifted, and never used for training by anyone. */
export function generateHoldout(seed: number, n = 1000): Example[] {
  return generate({ name: "holdout", description: "Balanced holdout", n, pArtefact: 0.5, noise: 1.0, labelNoise: 0.02, shift: [0, 0, 0, 0, 0, 0] }, seed);
}
