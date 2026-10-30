import { Card, Empty, EmployeeShell } from "@/components/portal/EmployeeShell";
import { JsonAction } from "@/components/portal/JsonAction";
import { JsonForm } from "@/components/portal/JsonForm";
import { guardEmployee } from "@/lib/auth/pages";
import { getDb } from "@/lib/db";
import { listTeams } from "@/lib/employee/service";

export const metadata = { title: "Hackathon spaces | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const g = await guardEmployee();
  if ("denied" in g) return g.denied;
  const teams = await listTeams(getDb(), g.session.principal);
  const me = g.session.user.id;

  return (
    <EmployeeShell session={g.session} active="teams" title="Build together." lead="Hackathon team spaces. Form a team around an idea, or join one.">
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {teams.length === 0 ? <Empty>No teams yet. Start one.</Empty> : teams.map((t) => {
            const joined = t.members.some((m) => m.userId === me);
            return (
              <Card key={t.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-lg font-semibold">{t.name}</p>
                  <JsonAction url={`/api/teams/${t.id}/membership`} body={{ action: joined ? "leave" : "join" }} label={joined ? "Leave team" : "Join team"} tone={joined ? "outline" : "solid"} />
                </div>
                <p className="mt-2 text-sm text-text">{t.description}</p>
                <p className="mt-3 text-xs text-muted">Members: {t.members.map((m) => m.name).join(", ") || "none"}</p>
              </Card>
            );
          })}
        </div>
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Start a team</h2>
          <JsonForm url="/api/teams" submit="Create team" fields={[
            { name: "name", label: "Team name", required: true, maxLength: 60 },
            { name: "description", label: "What are you building?", type: "textarea", required: true, maxLength: 500 },
          ]} />
        </Card>
      </div>
    </EmployeeShell>
  );
}
