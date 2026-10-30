import { Card, Empty } from "@/components/portal/EmployeeShell";
import { ClientShell } from "@/components/portal/ClientShell";
import { CommentThread } from "@/components/portal/CommentThread";
import { JsonAction } from "@/components/portal/JsonAction";
import { guardClient } from "@/lib/auth/pages";
import { listBookmarks } from "@/lib/client/collab";
import { listClientResources } from "@/lib/client/service";
import { getDb } from "@/lib/db";
import { dbAuditSink } from "@/lib/audit/log";
import { unreadCount } from "@/lib/notifications/inapp";

export const metadata = { title: "Resources | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const db = getDb();
  const r = await listClientResources(db, g.session.principal, dbAuditSink(db));
  const bookmarks = await listBookmarks(db, g.session.principal);
  const marked = new Set(bookmarks.map((b) => b.resourceId));
  const unread = await unreadCount(db, g.session.user.id);
  const me = g.session.user.id;
  const admin = g.session.principal.activeRole === "client_admin";

  const mark = (type: string, id: string) => (
    <JsonAction url="/api/bookmarks" body={{ type, id }} label={marked.has(id) ? "Bookmarked ✓" : "Bookmark"} />
  );

  return (
    <ClientShell session={g.session} active="resources" unread={unread} title="Resources"
      lead="Briefings, release notes, sessions and demonstrations addressed to your organisation. Comments are visible to your organisation only.">
      {bookmarks.length > 0 && (
        <section className="mb-12">
          <h2 className="text-lg font-semibold text-ink">Your bookmarks</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {bookmarks.map((b) => <li key={b.id}><a href={b.href} className="rounded-full bg-panel px-4 py-1.5 text-sm text-ink hover:bg-mint">{b.title}</a></li>)}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-ink">Release notes and briefings</h2>
        <div className="mt-3 space-y-4">
          {r.releaseNotes.length === 0 ? <Empty>No release notes have been shared with your organisation.</Empty> : r.releaseNotes.map((n) => (
            <Card key={n.id}>
              <div className="flex flex-wrap items-start justify-between gap-3"><p className="text-lg font-semibold">{n.title}</p>{mark("release_note", n.id)}</div>
              <p className="mt-2 whitespace-pre-line text-sm text-text">{n.body}</p>
              <CommentThread parentType="release_note" parentId={n.id} me={me} admin={admin} />
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-ink">Demonstrations and documents</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {r.media.length === 0 ? <div className="md:col-span-2"><Empty>No demonstrations or documents have been shared yet.</Empty></div> : r.media.map((m) => (
            <Card key={m.id}>
              <div className="flex flex-wrap items-start justify-between gap-3"><p className="font-semibold">{m.title}</p>{mark("media", m.id)}</div>
              {m.contentType.startsWith("video/") ? (
                <video controls preload="metadata" className="mt-3 w-full rounded-az" src={`/api/media/${m.id}`} />
              ) : m.contentType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${m.id}`} alt={m.title} className="mt-3 w-full rounded-az" />
              ) : <a href={`/api/media/${m.id}`} className="mt-3 inline-block text-sm underline">Open</a>}
              <CommentThread parentType="media" parentId={m.id} me={me} admin={admin} />
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-ink">Sessions and webinars</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {r.sessions.length === 0 ? <div className="md:col-span-2"><Empty>No sessions are scheduled for your organisation.</Empty></div> : r.sessions.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-wrap items-start justify-between gap-3"><p className="font-semibold">{s.title}</p>{mark("live_session", s.id)}</div>
              <p className="mt-1 text-sm text-text">{s.startsAt ? s.startsAt.toUTCString() : "Time to be announced"}</p>
              {s.streamRef && <a href={s.streamRef} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-sm font-semibold text-accent-text underline">Join →</a>}
              <CommentThread parentType="live_session" parentId={s.id} me={me} admin={admin} />
            </Card>
          ))}
        </div>
      </section>
    </ClientShell>
  );
}
