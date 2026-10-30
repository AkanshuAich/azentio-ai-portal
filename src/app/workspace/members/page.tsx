import { Card, Empty } from "@/components/portal/EmployeeShell";
import { ClientShell } from "@/components/portal/ClientShell";
import { JsonAction } from "@/components/portal/JsonAction";
import { JsonForm } from "@/components/portal/JsonForm";
import { RoleSelect } from "@/components/portal/RoleSelect";
import { guardClient } from "@/lib/auth/pages";
import { listMembers } from "@/lib/client/service";
import { getDb } from "@/lib/db";
import { dbAuditSink } from "@/lib/audit/log";
import { unreadCount } from "@/lib/notifications/inapp";

export const metadata = { title: "Members | azentio.ai" };
export const dynamic = "force-dynamic";

const STATE_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900", accepted: "bg-green/30 text-ink", expired: "bg-panel text-muted", cancelled: "bg-panel text-muted",
};
const MEMBER_STATUS: Record<string, string> = { active: "Active", invited: "Invited", revoked: "Revoked" };

export default async function MembersPage() {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const db = getDb();
  const unread = await unreadCount(db, g.session.user.id);

  if (g.session.principal.activeRole !== "client_admin") {
    return (
      <ClientShell session={g.session} active="members" unread={unread} title="Members">
        <Empty>Only an administrator of your organisation can manage members. Ask one of them if you need someone added.</Empty>
      </ClientShell>
    );
  }

  const { members, invitations } = await listMembers(db, g.session.principal, dbAuditSink(db));

  return (
    <ClientShell session={g.session} active="members" unread={unread} title="Members and invitations"
      lead="Invite colleagues, change client roles and revoke access. You can only manage your own organisation, and only client roles can be granted.">
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="space-y-10 lg:col-span-2">
          <section>
            <h2 className="text-lg font-semibold text-ink">Members</h2>
            <div className="mt-3 divide-y divide-white rounded-az-lg bg-panel text-ink">
              {members.map((m) => (
                <div key={m.userId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-semibold">{m.name} {m.you && <span className="text-xs font-normal text-muted">(you)</span>}</p>
                    <p className="text-xs text-muted">{m.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-white px-3 py-1 text-xs">{MEMBER_STATUS[m.status] ?? m.status}</span>
                    {m.status === "active" && !m.you ? (
                      <>
                        <RoleSelect userId={m.userId} value={m.role} />
                        <JsonAction url={`/api/client/members/${m.userId}`} method="DELETE" label="Revoke access" />
                      </>
                    ) : m.status === "active" ? <span className="text-sm text-muted">{m.role === "client_admin" ? "Administrator" : "Member"}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Invitations</h2>
            <div className="mt-3 space-y-3">
              {invitations.length === 0 ? <Empty>No invitations yet.</Empty> : invitations.map((i) => (
                <Card key={i.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{i.email}</p>
                      <p className="text-xs text-muted">{i.role === "client_admin" ? "Administrator" : "Member"} · expires {i.expiresAt.toISOString().slice(0, 10)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATE_STYLE[i.state]}`}>{i.state}</span>
                      {i.state === "pending" && <JsonAction url={`/api/client/invitations/${i.id}`} method="DELETE" label="Cancel" />}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        </div>

        <Card>
          <h2 className="mb-1 text-lg font-semibold">Invite someone</h2>
          <p className="mb-4 text-sm text-text">They get a single-use link that expires in 7 days and must sign in with this address.</p>
          <JsonForm url="/api/invitations" submit="Send invitation" fields={[
            { name: "email", label: "Email address", type: "text", required: true, maxLength: 254 },
            { name: "role", label: "Role", type: "select", defaultValue: "client_member", options: [{ value: "client_member", label: "Member" }, { value: "client_admin", label: "Administrator" }] },
          ]} />
          <p className="mt-4 text-xs text-muted">Employee, moderator, publisher and portal-administrator roles can&apos;t be granted from here.</p>
        </Card>
      </div>
    </ClientShell>
  );
}
