/**
 * A declared privacy accountant for the optional Gaussian noise on the aggregate.
 *
 * What it covers, exactly: the release of each round's aggregate under the Gaussian mechanism, with every
 * enrolled client taking part every round (no subsampling amplification is claimed), measured at the CLIENT level
 * (adding or removing one client's whole update), composed with Renyi DP and converted to (epsilon, delta).
 * What it assumes: a TRUSTED coordinator that sees individual updates before adding noise. It is central DP, not
 * local DP, and it is NOT secure aggregation. If noise is off, there is no accountant and no privacy claim.
 */
export interface DpReport {
  mechanism: string;
  epsilon: number;
  delta: number;
  noiseMultiplier: number;
  clipNorm: number;
  maxWeight: number;
  rounds: number;
  assumptions: string[];
}

/** epsilon(alpha) for T Gaussian releases with noise multiplier sigma is T*alpha/(2 sigma^2); minimise the conversion over alpha. */
export function rdpToEpsilon(noiseMultiplier: number, rounds: number, delta: number): number {
  let best = Infinity;
  for (let alpha = 1.1; alpha <= 512; alpha *= 1.05) {
    const eps = (rounds * alpha) / (2 * noiseMultiplier ** 2) + Math.log(1 / delta) / (alpha - 1);
    if (eps < best) best = eps;
  }
  return best;
}

export function dpReport(args: { noiseMultiplier: number; clipNorm: number; maxWeight: number; rounds: number; delta?: number }): DpReport {
  const delta = args.delta ?? 1e-5;
  return {
    mechanism: "Gaussian mechanism on the aggregate; RDP composition; client-level; full participation",
    epsilon: rdpToEpsilon(args.noiseMultiplier, args.rounds, delta),
    delta,
    noiseMultiplier: args.noiseMultiplier,
    clipNorm: args.clipNorm,
    maxWeight: args.maxWeight,
    rounds: args.rounds,
    assumptions: [
      "The coordinator is trusted: it sees each individual update before noise is added.",
      "This is not secure aggregation and not local differential privacy.",
      "Each client's update is clipped to the declared norm, and no client's share exceeds the declared maximum weight.",
      "Epsilon is for the released sequence of aggregates (the final model), not for any other output such as logs.",
    ],
  };
}
