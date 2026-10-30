import { Card, Empty, EmployeeShell } from "@/components/portal/EmployeeShell";
import { JsonForm } from "@/components/portal/JsonForm";
import { guardEmployee } from "@/lib/auth/pages";
import { getDb } from "@/lib/db";
import { listReleaseNotes } from "@/lib/employee/service";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const metadata = { title: "Release notes | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function ReleasesPage() {
  const g = await guardEmployee();
  if ("denied" in g) return g.denied;
  const notes = (await listReleaseNotes(getDb(), g.session.principal)).filter((n) => n.audience === "employee");
  const canPublish = g.session.principal.permissions.has("media.publish");
  const clientOrgs = canPublish ? await getDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.kind, "client")).orderBy(organizations.name) : [];

  return (
    <EmployeeShell session={g.session} active="releases" title="Internal release notes." lead="What changed and why. Client-facing release notes are published separately to the clients entitled to them.">
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {notes.length === 0 ? <Empty>No release notes yet.</Empty> : notes.map((n) => (
            <Card key={n.id}>
              <p className="text-lg font-semibold">{n.title}</p>
              <p className="mt-2 whitespace-pre-line text-sm text-text">{n.body}</p>
            </Card>
          ))}
        </div>
        {canPublish ? (
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Publish a release note</h2>
            <JsonForm url="/api/release-notes" submit="Publish" fields={[
              { name: "title", label: "Title", required: true, maxLength: 140 },
              { name: "body", label: "Notes", type: "textarea", required: true, maxLength: 4000 },
              { name: "audience", label: "Audience", type: "select", defaultValue: "employee", options: [{ value: "employee", label: "Employees only" }, { value: "tenant", label: "One client organisation" }] },
              { name: "orgId", label: "Client organisation (if chosen above)", type: "select", defaultValue: "", options: [{ value: "", label: "—" }, ...clientOrgs.map((o) => ({ value: o.id, label: o.name }))] },
            ]} />
          </Card>
        ) : (
          <Card><p className="text-sm text-text">Publishing release notes needs the <strong>media.publish</strong> grant.</p></Card>
        )}
      </div>
    </EmployeeShell>
  );
}
