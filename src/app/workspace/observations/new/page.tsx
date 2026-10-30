import { ClientShell } from "@/components/portal/ClientShell";
import { ObservationForm } from "@/components/learning/ObservationForm";
import { guardClient } from "@/lib/auth/pages";
import { getDb } from "@/lib/db";
import { unreadCount } from "@/lib/notifications/inapp";
import { listPublicProducts } from "@/lib/public/products";

export const metadata = { title: "New observation | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function NewObservationPage() {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const db = getDb();
  const offerings = (await listPublicProducts(db)).map((p) => ({ slug: p.slug, name: p.name }));
  return (
    <ClientShell session={g.session} active="observations" unread={await unreadCount(db, g.session.user.id)} title="New observation"
      lead="Start with a private draft. You decide later who might see it.">
      <div className="max-w-3xl"><ObservationForm mode="create" offerings={offerings} /></div>
    </ClientShell>
  );
}
