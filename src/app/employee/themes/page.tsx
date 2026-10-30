import { EmployeeShell } from "@/components/portal/EmployeeShell";
import { ThemeCards } from "@/components/learning/ThemeCards";
import { ThemeCurator } from "@/components/learning/ThemeCurator";
import { guardEmployee } from "@/lib/auth/pages";
import { dbAuditSink } from "@/lib/audit/log";
import { getDb } from "@/lib/db";
import { searchFeed } from "@/lib/learning/feed";
import { listThemes } from "@/lib/learning/themes";
import { listPublicProducts } from "@/lib/public/products";

export const metadata = { title: "Themes | azentio.ai" };
export const dynamic = "force-dynamic";

export default async function EmployeeThemesPage() {
  const g = await guardEmployee("learning.moderate");
  if ("denied" in g) return g.denied;
  const db = getDb();
  const audit = dbAuditSink(db);
  const themes = await listThemes(db, g.session.principal, audit);
  const feed = await searchFeed(db, g.session.principal, audit, { limit: 100 });
  const offerings = (await listPublicProducts(db)).map((p) => ({ slug: p.slug, name: p.name }));

  return (
    <EmployeeShell session={g.session} active="themes" title="Themes" lead="Curate recurring patterns. What clients see is exactly this view: a theme with too few contributing organisations shows no figures.">
      <ThemeCurator themes={themes.map((t) => ({ id: t.id, title: t.title }))} items={feed.items.map((i) => ({ id: i.id, title: i.title }))} offerings={offerings} />
      <div className="mt-12"><ThemeCards themes={themes} /></div>
    </EmployeeShell>
  );
}
