/**
 * The ONLY shape in which a shared (cross-client) contribution leaves the server.
 *
 * It is built by whitelisting reviewed fields from the publication row. It never spreads a row, so tenant
 * ids, author identity, contribution ids, reviewer notes, attachments and any hidden metadata cannot leak
 * by being added to a table later.
 */
export interface SharedPublicationDTO {
  id: string;
  title: string;
  body: string;
  offering: string;
  industry: string | null;
  region: string | null;
  observationPeriod: string | null;
  evidenceType: string | null;
  confidence: string | null;
  evidenceQuality: string | null;
  topic: string | null;
  version: number;
  publishedAt: string;
  /** Present only when the author opted in to attribution AND a moderator approved it. */
  contributor: string | null;
}

export interface PublicationRowLike {
  id: string;
  title: string;
  body: string;
  offering: string;
  industry: string | null;
  region: string | null;
  observationPeriod: string | null;
  evidenceType: string | null;
  confidence: string | null;
  evidenceQuality: string | null;
  topic: string | null;
  version: number;
  publishedAt: Date;
  attribution: string;
}

export function toSharedDTO(row: PublicationRowLike, orgNameIfAttributed?: string | null): SharedPublicationDTO {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    offering: row.offering,
    industry: row.industry,
    region: row.region,
    observationPeriod: row.observationPeriod,
    evidenceType: row.evidenceType,
    confidence: row.confidence,
    evidenceQuality: row.evidenceQuality,
    topic: row.topic,
    version: row.version,
    publishedAt: row.publishedAt.toISOString(),
    contributor: row.attribution === "organisation" ? orgNameIfAttributed ?? null : null,
  };
}

/** Keys that must never appear anywhere in a shared payload, at any depth. */
export const FORBIDDEN_SHARED_KEYS = [
  "orgId", "org_id", "tenantId", "tenant_id", "authorId", "author_id", "userId", "user_id",
  "contributionId", "contribution_id", "privateNotes", "private_notes", "reviewerNotes", "attachments",
  "sensitiveFlags", "sensitive_flags", "sharingChoice", "consents", "email",
] as const;

/** Walks a payload and returns the path of any forbidden key. Used by tests and as a runtime assertion. */
export function findForbiddenKey(value: unknown, path = "$"): string | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) { const hit = findForbiddenKey(value[i], `${path}[${i}]`); if (hit) return hit; }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_SHARED_KEYS as readonly string[]).includes(k)) return `${path}.${k}`;
    const hit = findForbiddenKey(v, `${path}.${k}`);
    if (hit) return hit;
  }
  return null;
}
