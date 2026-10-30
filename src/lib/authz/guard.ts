import { can } from "./policy";
import type { Action, Decision, Principal, Resource } from "./types";

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(public readonly decision: Decision) {
    super(`Forbidden: ${decision.reason}`);
    this.name = "ForbiddenError";
  }
}

export interface AuditRecord {
  actorId: string | null;
  action: Action;
  subjectType: string | null;
  subjectId: string | null;
  orgId: string | null;
  allowed: boolean;
  reason: string;
}

/** Injected so the guard stays testable; production wires this to audit_events. */
export type AuditSink = (record: AuditRecord) => Promise<void> | void;

/** Privileged actions are audited whether they succeed or are refused. */
const AUDITED_ACTIONS = new Set<Action>([
  "moderate",
  "publish_media",
  "invite_member",
  "grant_role",
  "manage_ideas",
  "administer",
  "access_private",
]);

export interface GuardContext {
  principal: Principal | null;
  audit: AuditSink;
  subjectType?: string;
  subjectId?: string;
}

/**
 * Every route handler and server action calls this before touching data. Throws ForbiddenError (403)
 * unless the policy allows. Request input is never consulted for authority: the principal comes from
 * the session, and the resource's tenant/audience come from the stored record.
 */
export async function requirePermission(
  ctx: GuardContext,
  action: Action,
  resource: Resource,
): Promise<Decision> {
  const decision = can(ctx.principal, action, resource);

  if (AUDITED_ACTIONS.has(action) || !decision.allow) {
    await ctx.audit({
      actorId: ctx.principal?.userId ?? null,
      action,
      subjectType: ctx.subjectType ?? null,
      subjectId: ctx.subjectId ?? null,
      orgId: resource.orgId ?? ctx.principal?.activeOrgId ?? null,
      allowed: decision.allow,
      reason: decision.reason,
    });
  }

  if (!decision.allow) throw new ForbiddenError(decision);
  return decision;
}
