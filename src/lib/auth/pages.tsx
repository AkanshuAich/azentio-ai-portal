import { redirect } from "next/navigation";
import { getSession } from "./http";
import { can } from "@/lib/authz/policy";
import type { Permission } from "@/lib/authz/types";
import type { SessionContext } from "./session";
import { landingFor } from "./landing";

export function Denied({ title, text }: { title: string; text: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-navy px-6 text-center text-white">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-mint">403</p>
        <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
        <p className="mt-3 max-w-md text-white/70">{text}</p>
      </div>
    </main>
  );
}

/**
 * Per-page guard. Layouts are not re-run on client-side navigation, so every protected page calls this
 * itself. The employee audience, not a menu link, decides; an optional grant narrows it further.
 */
export async function guardEmployee(
  grant?: Permission | Permission[],
): Promise<{ session: SessionContext } | { denied: React.ReactElement }> {
  const session = await getSession();
  if (!session) redirect("/signin");

  if (!can(session.principal, "read", { audience: "employee" }).allow) {
    return { denied: <Denied title="This area is for Azentio employees" text="Your account doesn't have an approved employee membership." /> };
  }
  // An array means any one of the listed grants is enough.
  const grants = grant === undefined ? [] : Array.isArray(grant) ? grant : [grant];
  if (grants.length && !grants.some((g) => session.principal.permissions.has(g))) {
    return { denied: <Denied title="You don't have access to this" text={`This needs the ${grants.join(" or ")} grant, which is separate from being an employee. Ask a portal administrator if you need it.`} /> };
  }
  return { session };
}

/**
 * Per-page guard for the client portal. The caller must hold an active client workspace; a signed-in user
 * who is mid-onboarding or has not chosen a workspace is sent where they belong, and an employee gets a
 * 403 because employee status confers no access to any client workspace.
 */
export async function guardClient(): Promise<{ session: SessionContext; orgId: string } | { denied: React.ReactElement }> {
  const session = await getSession();
  if (!session) redirect("/signin");
  const { activeOrgId, activeRole } = session.principal;
  if (!activeOrgId) redirect(landingFor(session));
  if (activeRole !== "client_member" && activeRole !== "client_admin") {
    return { denied: <Denied title="This area is for client workspaces" text="Employees use the employee portal. Employee status doesn't give access to any client's workspace." /> };
  }
  return { session, orgId: activeOrgId };
}
