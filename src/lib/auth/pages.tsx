import { redirect } from "next/navigation";
import { getSession } from "./http";
import { can } from "@/lib/authz/policy";
import type { Permission } from "@/lib/authz/types";
import type { SessionContext } from "./session";

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
  grant?: Permission,
): Promise<{ session: SessionContext } | { denied: React.ReactElement }> {
  const session = await getSession();
  if (!session) redirect("/signin");

  if (!can(session.principal, "read", { audience: "employee" }).allow) {
    return { denied: <Denied title="This area is for Azentio employees" text="Your account doesn't have an approved employee membership." /> };
  }
  if (grant && !session.principal.permissions.has(grant)) {
    return { denied: <Denied title="You don't have access to this" text={`This needs the ${grant} grant, which is separate from being an employee. Ask a portal administrator if you need it.`} /> };
  }
  return { session };
}
