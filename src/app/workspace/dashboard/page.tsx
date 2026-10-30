import { redirect } from "next/navigation";
import { PortalHeader } from "@/components/auth/PortalHeader";
import { getSession } from "@/lib/auth/http";
import { landingFor } from "@/lib/auth/landing";
import { getDb } from "@/lib/db";
import { entitlements } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const metadata = { title: "Client workspace | azentio.ai" };

export default async function WorkspaceDashboard() {
  const session = await getSession();
  if (!session) redirect("/signin");
  const { activeOrgId, activeRole } = session.principal;
  // Employees have their own portal; they get no automatic view into any client workspace.
  if (!activeOrgId || activeRole === "employee") redirect(landingFor(session));

  const owned = await getDb().select().from(entitlements).where(eq(entitlements.orgId, activeOrgId));
  const org = session.workspaces.find((w) => w.orgId === activeOrgId)!;

  return (
    <>
      <PortalHeader displayName={session.user.displayName} activeOrgId={activeOrgId} workspaces={session.workspaces} />
      <main className="mx-auto max-w-[1200px] px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-text">Client workspace</p>
        <h1 className="mt-2 text-4xl font-semibold text-ink">{org.orgName}</h1>
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Entitled offerings</h2>
          {owned.length === 0 ? (
            <p className="mt-3 rounded-az-lg bg-panel p-6 text-muted">
              No offerings have been enabled for your organisation yet. Your Azentio contact can enable them.
            </p>
          ) : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {owned.map((e) => (
                <li key={e.id} className="rounded-az-lg bg-panel p-5 text-ink shadow-[var(--az-shadow-card)]">{e.productSlug}</li>
              ))}
            </ul>
          )}
        </section>
        <p className="mt-10 text-sm text-muted">Demonstrations, observations and shared learning arrive in the next build phases.</p>
      </main>
    </>
  );
}
