import Link from "next/link";
import { eq } from "drizzle-orm";
import { Card, Empty, EmployeeShell } from "@/components/portal/EmployeeShell";
import { guardEmployee } from "@/lib/auth/pages";
import { getDb } from "@/lib/db";
import { improvementIdeas } from "@/lib/db/schema";
import { listLiveSessions } from "@/lib/employee/service";

export const metadata = { title: "Employee portal | azentio.ai" };
export const dynamic = "force-dynamic";

const QUICK = [
  { href: "/employee/playground", title: "Playground", text: "Run guided demonstrations on synthetic data." },
  { href: "/employee/live", title: "Live sessions", text: "Internal broadcasts and recordings." },
  { href: "/employee/experiments", title: "Experiments", text: "Submit and track internal experiments." },
  { href: "/employee/teams", title: "Hackathon spaces", text: "Form or join a team." },
  { href: "/employee/knowledge", title: "Knowledge library", text: "Guides with owners and review dates." },
  { href: "/employee/releases", title: "Release notes", text: "What changed, internally." },
];

export default async function EmployeeDashboard() {
  const g = await guardEmployee();
  if ("denied" in g) return g.denied;
  const { session } = g;
  const db = getDb();

  const now = Date.now();
  const upcoming = (await listLiveSessions(db, session.principal)).filter((s) => s.startsAt && s.startsAt.getTime() >= now).slice(0, 3);
  const assigned = await db.select().from(improvementIdeas).where(eq(improvementIdeas.ownerUserId, session.user.id));
  const granted = [...session.principal.permissions];

  return (
    <EmployeeShell session={session} active="dashboard" title={`Welcome, ${session.user.displayName}`} lead="Everything here is internal. Public product information lives on the public site.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK.map((q) => (
          <Link key={q.href} href={q.href} className="block rounded-az-lg bg-panel p-5 text-ink transition hover:-translate-y-0.5 hover:shadow-[var(--az-shadow-card)]">
            <p className="font-semibold">{q.title}</p>
            <p className="mt-1 text-sm text-text">{q.text}</p>
          </Link>
        ))}
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold text-ink">Upcoming internal sessions</h2>
          <div className="mt-3 space-y-3">
            {upcoming.length === 0 ? <Empty>No sessions are scheduled.</Empty> : upcoming.map((s) => (
              <Card key={s.id}><p className="font-semibold">{s.title}</p><p className="text-sm text-text">{s.startsAt?.toUTCString()}</p></Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">Improvement ideas assigned to you</h2>
          <div className="mt-3 space-y-3">
            {assigned.length === 0 ? <Empty>Nothing is assigned to you.</Empty> : assigned.map((i) => (
              <Card key={i.id}>
                <p className="font-semibold">{i.title}</p>
                <p className="text-sm text-text">{i.status.replace("_", " ")} · {i.ownerTeam}</p>
              </Card>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Assignment gives access only to the evidence shared for that purpose.</p>
        </section>
      </div>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-ink">Your platform grants</h2>
        <p className="mt-1 text-sm text-muted">Being an employee grants none of these. Each is a separate, audited permission.</p>
        {granted.length === 0 ? (
          <div className="mt-3"><Empty>You have no additional grants.</Empty></div>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {granted.map((p) => <li key={p} className="rounded-full bg-navy px-4 py-1.5 text-sm text-mint">{p}</li>)}
          </ul>
        )}
      </section>
    </EmployeeShell>
  );
}
