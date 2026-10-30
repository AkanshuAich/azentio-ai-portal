import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  airaChunks, contributionReports, searchDocuments, sharedPublications,
} from "@/lib/db/schema";
import type { AuditSink } from "@/lib/authz/guard";
import { applyTransition, bumpEpoch, tellAuthor, type Contribution } from "./core";
import type { Actor } from "./lifecycle";

export interface WithdrawalResult {
  publicationsWithdrawn: number;
  searchEntriesRemoved: number;
  retrievalChunksRemoved: number;
  /** Wall-clock time for the whole fan-out. The brief asks for synchronous, or within 60 seconds. */
  elapsedMs: number;
}

/**
 * Withdraws a contribution and invalidates everything derived from it, in ONE transaction, so there is
 * no window in which the item is gone from the record but still searchable or retrievable:
 *   publication marked withdrawn -> search entries deleted -> AIRA retrieval chunks deleted ->
 *   feed cache epoch bumped -> open reports resolved -> status moved.
 * What it cannot do: recall material someone already viewed, or copies made outside this system.
 */
export async function withdrawContribution(
  db: Db, c: Contribution, actor: Actor, actorId: string, audit: AuditSink, note: string | null, now = new Date(),
): Promise<WithdrawalResult> {
  const t0 = performance.now();
  let result!: Omit<WithdrawalResult, "elapsedMs">;
  let afterCommit!: () => Promise<void>;

  await db.transaction(async (tx) => {
    const live = await tx
      .select({ id: sharedPublications.id })
      .from(sharedPublications)
      .where(and(eq(sharedPublications.contributionId, c.id), isNull(sharedPublications.withdrawnAt)));
    const ids = live.map((p) => p.id);

    let searchRemoved = 0;
    let chunksRemoved = 0;
    if (ids.length > 0) {
      await tx.update(sharedPublications).set({ withdrawnAt: now }).where(inArray(sharedPublications.id, ids));
      searchRemoved = (await tx.delete(searchDocuments).where(inArray(searchDocuments.publicationId, ids)).returning({ id: searchDocuments.id })).length;
      chunksRemoved = (await tx.delete(airaChunks).where(inArray(airaChunks.publicationId, ids)).returning({ id: airaChunks.id })).length;
      await tx
        .update(contributionReports)
        .set({ status: "resolved", resolution: "Withdrawn by the contributor", resolvedAt: now })
        .where(and(inArray(contributionReports.publicationId, ids), eq(contributionReports.status, "open")));
    }
    await bumpEpoch(tx);
    afterCommit = await applyTransition({ q: tx, audit, actorId, actor }, c, "withdrawn", note);
    result = { publicationsWithdrawn: ids.length, searchEntriesRemoved: searchRemoved, retrievalChunksRemoved: chunksRemoved };
  });

  const elapsedMs = Math.round(performance.now() - t0);
  await afterCommit();
  await audit({
    actorId, action: actor === "moderator" ? "moderate" : "write", subjectType: "contribution_withdrawal", subjectId: c.id, orgId: c.orgId,
    allowed: true, reason: "withdrawal fan-out complete", detail: { ...result, elapsedMs },
  });
  await tellAuthor(db, c, actor === "author" ? "You withdrew your contribution. It is no longer searchable or used by AIRA" : `Your contribution was withdrawn by a moderator${note ? `: ${note}` : ""}`);
  return { ...result, elapsedMs };
}
