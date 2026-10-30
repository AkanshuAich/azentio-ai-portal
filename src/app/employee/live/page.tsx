import { inArray } from "drizzle-orm";
import { Card, Empty, EmployeeShell } from "@/components/portal/EmployeeShell";
import { guardEmployee } from "@/lib/auth/pages";
import { getDb } from "@/lib/db";
import { mediaAssets } from "@/lib/db/schema";
import { listLiveSessions } from "@/lib/employee/service";

export const metadata = { title: "Live | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function LivePage() {
  const g = await guardEmployee();
  if ("denied" in g) return g.denied;
  const db = getDb();

  // Only employee-audience sessions belong on this page; public ones are shown on the public site.
  const sessions = (await listLiveSessions(db, g.session.principal)).filter((s) => s.audience === "employee");
  const ids = sessions.map((s) => s.recordingAssetId).filter((x): x is string => x !== null);
  const assets = ids.length ? await db.select().from(mediaAssets).where(inArray(mediaAssets.id, ids)) : [];
  const now = Date.now();
  const upcoming = sessions.filter((s) => !s.recordingAssetId && (!s.startsAt || s.startsAt.getTime() >= now));
  const recorded = sessions.filter((s) => s.recordingAssetId);

  return (
    <EmployeeShell session={g.session} active="live" title="Where intelligence comes alive." lead="Internal live conversations and past recordings. These are visible to employees only.">
      <h2 className="text-lg font-semibold text-ink">Live and upcoming</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {upcoming.length === 0 ? <Empty>No internal session is scheduled right now.</Empty> : upcoming.map((s) => (
          <Card key={s.id}>
            <p className="text-lg font-semibold">{s.title}</p>
            <p className="mt-1 text-sm text-text">{s.startsAt ? s.startsAt.toUTCString() : "Time to be announced"}</p>
            {s.streamRef ? (
              <a href={s.streamRef} target="_blank" rel="noreferrer noopener" className="mt-3 inline-block rounded-full bg-[var(--az-cta-dark)] px-5 py-2 text-sm font-semibold text-white hover:bg-card">Join the stream</a>
            ) : <p className="mt-3 text-sm text-muted">Stream link not published yet.</p>}
          </Card>
        ))}
      </div>

      <h2 className="mt-12 text-lg font-semibold text-ink">Past recordings</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {recorded.length === 0 ? <Empty>No recordings have been published.</Empty> : recorded.map((s) => {
          const a = assets.find((x) => x.id === s.recordingAssetId);
          return (
            <Card key={s.id}>
              <p className="font-semibold">{s.title}</p>
              {a?.contentType.startsWith("video/") ? (
                // Served through the gated media route, which re-checks the audience on every request.
                <video controls preload="metadata" className="mt-3 w-full rounded-az" src={`/api/media/${a.id}`} />
              ) : a?.contentType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${a.id}`} alt={`${s.title} recording slate`} className="mt-3 w-full rounded-az" />
              ) : a ? (
                <a href={`/api/media/${a.id}`} className="mt-3 inline-block underline">Open recording</a>
              ) : null}
            </Card>
          );
        })}
      </div>
    </EmployeeShell>
  );
}
