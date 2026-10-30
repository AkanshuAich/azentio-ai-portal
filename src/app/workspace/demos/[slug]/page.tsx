import { notFound } from "next/navigation";
import { ClientShell } from "@/components/portal/ClientShell";
import { Empty } from "@/components/portal/EmployeeShell";
import { PlaygroundClient } from "@/components/portal/PlaygroundClient";
import { guardClient } from "@/lib/auth/pages";
import { listSandboxes, listSavedScenarios } from "@/lib/client/service";
import { getDb } from "@/lib/db";
import { unreadCount } from "@/lib/notifications/inapp";
import { SCENARIOS } from "@/lib/playground/scenarios";

export const metadata = { title: "Sandbox | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function SandboxPage({ params }: { params: Promise<{ slug: string }> }) {
  const g = await guardClient();
  if ("denied" in g) return g.denied;
  const { slug } = await params;
  const db = getDb();
  const unread = await unreadCount(db, g.session.user.id);

  // A product with no sandbox does not exist here. A product the organisation is NOT entitled to is shown
  // the same way as one that doesn't exist, so a guessed URL reveals nothing.
  if (!SCENARIOS.some((s) => s.meta.productSlug === slug)) notFound();
  const entitled = listSandboxes(g.session.principal);
  const mine = entitled.filter((s) => s.productSlug === slug);
  const saved = await listSavedScenarios(db, g.session.principal);

  return (
    <ClientShell session={g.session} active="demos" unread={unread} title={mine[0]?.title ?? "Sandbox"}
      lead="Runs and saved scenarios are private to you and your organisation. Nothing here uses real customer data.">
      {mine.length === 0 ? (
        <Empty>This sandbox isn&apos;t enabled for your organisation. Your Azentio contact can enable it.</Empty>
      ) : (
        <PlaygroundClient mode="client" scenarios={mine} initialId={mine[0].id} saved={saved.filter((x) => mine.some((m) => m.id === x.scenarioId))} />
      )}
    </ClientShell>
  );
}
