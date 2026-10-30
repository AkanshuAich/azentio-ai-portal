import type { AuditRecord, AuditSink } from "@/lib/authz/guard";
import { auditEvents } from "@/lib/db/schema";
import type { Db } from "@/lib/db/client";

/** Production sink: persists every audited decision to audit_events. */
export function dbAuditSink(db: Db): AuditSink {
  return async (r: AuditRecord) => {
    await db.insert(auditEvents).values({
      actorId: r.actorId,
      action: r.action,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      orgId: r.orgId,
      allowed: r.allowed,
      detail: { reason: r.reason },
    });
  };
}
