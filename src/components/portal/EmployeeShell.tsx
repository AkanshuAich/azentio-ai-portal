import Link from "next/link";
import { PortalHeader } from "@/components/auth/PortalHeader";
import type { SessionContext } from "@/lib/auth/session";

const LINKS = [
  { id: "dashboard", href: "/employee/dashboard", label: "Dashboard" },
  { id: "playground", href: "/employee/playground", label: "Playground" },
  { id: "live", href: "/employee/live", label: "Live" },
  { id: "experiments", href: "/employee/experiments", label: "Experiments" },
  { id: "teams", href: "/employee/teams", label: "Hackathon" },
  { id: "knowledge", href: "/employee/knowledge", label: "Knowledge" },
  { id: "releases", href: "/employee/releases", label: "Release notes" },
  { id: "learning", href: "/employee/learning", label: "Shared learning" },
] as const;

/** Page chrome only. Showing or hiding a link never grants or removes access: every page and API checks the server. */
export function EmployeeShell({
  session, active, title, lead, children,
}: { session: SessionContext; active: string; title: string; lead?: string; children: React.ReactNode }) {
  const canPublish = session.principal.permissions.has("media.publish");
  const canModerate = session.principal.permissions.has("learning.moderate");
  const canIdeas = session.principal.permissions.has("ideas.manage");
  const canFederated = session.principal.permissions.has("federated.coordinate") || session.principal.permissions.has("federated.approve");
  // Display only. Each of these pages and APIs checks its own grant on the server.
  const extra = [
    ...(canModerate ? [{ id: "moderation", href: "/employee/moderation", label: "Moderation" }, { id: "themes", href: "/employee/themes", label: "Themes" }] : []),
    ...(canIdeas ? [{ id: "ideas", href: "/employee/ideas", label: "Ideas" }] : []),
    ...(canFederated ? [{ id: "federated", href: "/employee/federated", label: "Federated" }] : []),
    ...(canPublish ? [{ id: "publishing", href: "/employee/publishing", label: "Publishing" }] : []),
  ];
  return (
    <>
      <PortalHeader displayName={session.user.displayName} activeOrgId={session.principal.activeOrgId} workspaces={session.workspaces} />
      <nav aria-label="Employee portal" className="border-b border-panel bg-white">
        <ul className="mx-auto flex max-w-[1200px] gap-1 overflow-x-auto px-6 text-sm">
          {[...LINKS, ...extra].map((l) => (
            <li key={l.id}>
              <Link
                href={l.href}
                aria-current={active === l.id ? "page" : undefined}
                className={`block whitespace-nowrap border-b-2 px-4 py-3 ${active === l.id ? "border-green font-semibold text-ink" : "border-transparent text-text hover:text-ink"}`}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="mx-auto max-w-[1200px] px-6 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-text">Employee portal</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink sm:text-4xl">{title}</h1>
        {lead && <p className="mt-3 max-w-2xl text-text">{lead}</p>}
        <div className="mt-8">{children}</div>
      </main>
    </>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-az-lg bg-panel p-5 text-ink ${className}`}>{children}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-az-lg border border-dashed border-[#c9d3d9] p-6 text-muted">{children}</p>;
}
