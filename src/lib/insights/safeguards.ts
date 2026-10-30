/**
 * Aggregation safeguards for cross-client statistics.
 *
 * Rules, all enforced server-side:
 *  1. Evidence strength is the number of DISTINCT contributing organisations, never the number of posts.
 *  2. Below the minimum, the figure is withheld entirely: no number, and no evidence links that would
 *     let a reader work the number out.
 *  3. Statistics are never computed over user-supplied filters, so a reader can't difference two filtered
 *     views to isolate a small cohort. They are fixed per theme.
 *
 * A minimum cohort size is NOT a privacy guarantee on its own. Production thresholds and any stronger
 * controls (suppression policy, differential privacy) need approval before launch.
 */
export const DEFAULT_MIN_DISTINCT_ORGS = 3;
/** Never allow a threshold below 2, whatever the configuration says. */
export const FLOOR = 2;

export function minDistinctOrgs(env: string | undefined = process.env.MIN_DISTINCT_ORGS): number {
  const n = Number.parseInt(env ?? "", 10);
  return Number.isFinite(n) ? Math.max(FLOOR, n) : DEFAULT_MIN_DISTINCT_ORGS;
}

export type CohortStat =
  | { suppressed: false; distinctOrgs: number }
  | { suppressed: true; reason: string };

/** Counts distinct organisations from a list that may contain many items per organisation. */
export function cohortStat(orgIds: Iterable<string>, min = minDistinctOrgs()): CohortStat {
  const distinct = new Set(orgIds).size;
  if (distinct < min) {
    return { suppressed: true, reason: `Fewer than ${min} organisations have contributed, so counts and supporting links are withheld.` };
  }
  return { suppressed: false, distinctOrgs: distinct };
}

/** For facet buckets: show an item count only when enough distinct organisations stand behind it. */
export function bucketCount(items: number, orgIds: Iterable<string>, min = minDistinctOrgs()): number | null {
  return new Set(orgIds).size >= min ? items : null;
}
