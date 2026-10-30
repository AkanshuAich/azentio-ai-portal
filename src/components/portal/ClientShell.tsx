import Link from "next/link";
import { PortalHeader } from "@/components/auth/PortalHeader";
import type { SessionContext } from "@/lib/auth/session";

const LINKS = [
  { id: "dashboard", href: "/workspace/dashboard", label: "Dashboard" },
  { id: "demos", href: "/workspace/demos", label: "Demonstrations" },
  { id: "resources", href: "/workspace/resources", label: "Resources" },
  { id: "support", href: "/workspace/support", label: "Support" },
] as const;

/** Page chrome only. Links never grant access: every page and API checks the server-side session. */
export function ClientShell({
  session, active, title, lead, unread, children,
}: { session: SessionContext; active: string; title: string; lead?: string; unread: number; children: React.ReactNode }) {
  const admin = session.principal.activeRole === "client_admin";
  const orgName = session.workspaces.find((w) => w.orgId === session.principal.activeOrgId)?.orgName;
  const links = [...LINKS, ...(admin ? [{ id: "members", href: "/workspace/members", label: "Members" }] : [])];
  return (
    <>
      <PortalHeader displayName={session.user.displayName} activeOrgId={session.principal.activeOrgId} workspaces={session.workspaces} unread={unread} />
      <nav aria-label="Client workspace" className="border-b border-panel bg-white">
        <ul className="mx-auto flex max-w-[1200px] gap-1 overflow-x-auto px-6 text-sm">
          {links.map((l) => (
            <li key={l.id}>
              <Link href={l.href} aria-current={active === l.id ? "page" : undefined}
                className={`block whitespace-nowrap border-b-2 px-4 py-3 ${active === l.id ? "border-green font-semibold text-ink" : "border-transparent text-text hover:text-ink"}`}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="mx-auto max-w-[1200px] px-6 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-text">{orgName ?? "Client workspace"}</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink sm:text-4xl">{title}</h1>
        {lead && <p className="mt-3 max-w-2xl text-text">{lead}</p>}
        <div className="mt-8">{children}</div>
      </main>
    </>
  );
}
