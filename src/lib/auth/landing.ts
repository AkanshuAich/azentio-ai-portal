import type { SessionContext } from "./session";

/** Where a signed-in user belongs next. Pure routing: it grants nothing, pages and APIs still authorise. */
export function landingFor(ctx: SessionContext): string {
  if (ctx.workspaces.some((w) => !w.termsAccepted)) return "/onboarding/terms";
  const { activeOrgId, activeRole } = ctx.principal;
  if (activeOrgId) return activeRole === "employee" ? "/employee/dashboard" : "/workspace/dashboard";
  if (ctx.workspaces.length > 1) return "/select-workspace";
  return "/no-workspace";
}
