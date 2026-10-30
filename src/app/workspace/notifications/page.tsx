import { Card, Empty } from "@/components/portal/EmployeeShell";
import { ClientShell } from "@/components/portal/ClientShell";
import { JsonAction } from "@/components/portal/JsonAction";
import { guardClient } from "@/lib/auth/pages";
import { getDb } from "@/lib/db";
import { listNotifications, unreadCount } from "@/lib/notifications/inapp";

export const metadata = { title: "Notifications | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const db = getDb();
  const items = await listNotifications(db, g.session.user.id);
  const unread = await unreadCount(db, g.session.user.id);

  return (
    <ClientShell session={g.session} active="notifications" unread={unread} title="Notifications"
      lead="Updates about your contributions and your workspace. These are in-app only: no email is sent from here.">
      {items.length === 0 ? <Empty>You have no notifications.</Empty> : (
        <>
          {unread > 0 && <div className="mb-4"><JsonAction url="/api/notifications" body={{}} label="Mark all as read" /></div>}
          <div className="space-y-3">
            {items.map((n) => (
              <Card key={n.id} className={n.readAt ? "opacity-70" : "border-l-4 border-green"}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{n.message}</p>
                    <p className="text-xs text-muted">{n.at.toUTCString()}</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {n.href && <a href={n.href} className="font-semibold text-accent-text underline">Open</a>}
                    {!n.readAt && <JsonAction url="/api/notifications" body={{ id: n.id }} label="Mark read" />}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </ClientShell>
  );
}
