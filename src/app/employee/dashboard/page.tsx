import { redirect } from "next/navigation";
import { PortalHeader } from "@/components/auth/PortalHeader";
import { getSession } from "@/lib/auth/http";
import { can } from "@/lib/authz/policy";

export const metadata = { title: "Employee portal | azentio.ai" };

export default async function EmployeeDashboard() {
  const session = await getSession();
  if (!session) redirect("/signin");

  // Server-side: the employee audience, not a menu link, decides who sees this page.
  if (!can(session.principal, "read", { audience: "employee" }).allow) {
    return (
      <main className="grid min-h-screen place-items-center bg-navy px-6 text-center text-white">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-mint">403</p>
          <h1 className="mt-2 text-3xl font-semibold">This area is for Azentio employees</h1>
          <p className="mt-3 text-white/70">Your account doesn&apos;t have an approved employee membership.</p>
        </div>
      </main>
    );
  }

  const granted = [...session.principal.permissions];
  return (
    <>
      <PortalHeader displayName={session.user.displayName} activeOrgId={session.principal.activeOrgId} workspaces={session.workspaces} />
      <main className="mx-auto max-w-[1200px] px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-text">Employee portal</p>
        <h1 className="mt-2 text-4xl font-semibold text-ink">Welcome, {session.user.displayName}</h1>
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Your platform grants</h2>
          <p className="mt-1 text-sm text-muted">
            Being an employee grants none of these. Each is a separate, audited permission.
          </p>
          {granted.length === 0 ? (
            <p className="mt-3 rounded-az-lg bg-panel p-6 text-muted">You have no additional grants.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {granted.map((g) => (
                <li key={g} className="rounded-full bg-navy px-4 py-1.5 text-sm text-mint">{g}</li>
              ))}
            </ul>
          )}
        </section>
        <p className="mt-10 text-sm text-muted">Playground, live sessions, experiments and the knowledge library arrive in Phase 3.</p>
      </main>
    </>
  );
}
